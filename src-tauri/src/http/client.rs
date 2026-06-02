// The shared reqwest client + the `http_send` worker. One strict client built once
// and held in managed state; `send` runs off the IPC thread (it is `async`, driven by
// the Tauri/tokio runtime). Timing wraps send→body-read; the body is read with a hard
// cap so a hostile/huge response can't blow up memory.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use reqwest::{Client, Method};

use crate::error::AppError;
use crate::http::types::{HttpRequest, HttpResponse};

/// Default per-request timeout. Hardcoded for v1 (configurable later).
const DEFAULT_TIMEOUT_SECS: u64 = 30;
/// Hard cap on the buffered response body (16 MiB). Beyond this the body is
/// truncated and `size_bytes` reflects the captured prefix — full streaming is
/// deferred (a workbench shows a body, it isn't a download manager).
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

/// Managed Tauri state: the one process-wide HTTP client. `Client` is cheaply
/// cloneable (Arc inside); we keep a single instance so connections pool.
pub struct HttpClient(pub Client);

impl HttpClient {
    /// Build the strict client (native roots via rustls-platform-verifier — no
    /// insecure path). Fails only if the TLS backend can't initialize.
    pub fn new() -> Result<Self, AppError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
            .build()
            .map_err(map_reqwest_err)?;
        Ok(HttpClient(client))
    }
}

/// Map a reqwest error to a readable `AppError` WITHOUT the URL — `without_url`
/// strips any URL the error captured, so a secret resolved into a URL (Phase 5)
/// can never ride along in the message.
fn map_reqwest_err(e: reqwest::Error) -> AppError {
    let e = e.without_url();
    let detail = if e.is_timeout() {
        "request timed out".to_string()
    } else if e.is_connect() {
        format!("connection failed: {e}")
    } else if e.is_builder() {
        format!("invalid request: {e}")
    } else if e.is_request() {
        format!("request error: {e}")
    } else {
        e.to_string()
    };
    AppError::Http(detail)
}

/// Perform one HTTP request. Separated from the Tauri command so integration tests
/// can drive it directly (and with a short-timeout client for the timeout case).
pub async fn send(client: &Client, req: HttpRequest) -> Result<HttpResponse, AppError> {
    let method = Method::from_bytes(req.method.trim().to_ascii_uppercase().as_bytes())
        .map_err(|_| AppError::Http(format!("invalid method: {}", req.method)))?;

    let mut rb = client.request(method, &req.url);
    for (k, v) in &req.headers {
        rb = rb.header(k, v);
    }
    if let Some(body) = req.body {
        rb = rb.body(body);
    }

    let start = Instant::now();
    let resp = rb.send().await.map_err(map_reqwest_err)?;

    let status = resp.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers = collect_headers(resp.headers());

    let (body, size_bytes) = read_capped_body(resp).await?;
    let timing_ms = start.elapsed().as_millis() as u64;

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
        timing_ms,
        size_bytes: size_bytes as u64,
    })
}

/// Fold a reqwest `HeaderMap` into an ordered `BTreeMap`. Duplicate header names
/// (e.g. multiple `set-cookie`) join with ", " rather than silently dropping.
fn collect_headers(map: &reqwest::header::HeaderMap) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in map.iter() {
        let v = value.to_str().unwrap_or("").to_string();
        out.entry(name.as_str().to_string())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&v);
            })
            .or_insert(v);
    }
    out
}

/// Stream the body chunk-by-chunk, stopping at `MAX_BODY_BYTES`. Returns the
/// (lossy-UTF8) text and the captured byte count.
async fn read_capped_body(mut resp: reqwest::Response) -> Result<(String, usize), AppError> {
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(map_reqwest_err)? {
        if buf.len() + chunk.len() > MAX_BODY_BYTES {
            let take = MAX_BODY_BYTES.saturating_sub(buf.len());
            buf.extend_from_slice(&chunk[..take]);
            break;
        }
        buf.extend_from_slice(&chunk);
    }
    let size = buf.len();
    Ok((String::from_utf8_lossy(&buf).into_owned(), size))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Error mapping is the part worth unit-testing in isolation (the happy path is
    // covered by the integration test against a live echo server). Connection-refused
    // and bad-URL are driven through a real client so the reqwest error kinds are real.

    #[tokio::test]
    async fn connection_refused_maps_to_http_error_without_url() {
        let client = Client::builder().timeout(Duration::from_secs(2)).build().unwrap();
        // Port 1 is privileged/unused — connect refused/blocked fast.
        let err = send(&client, HttpRequest {
            method: "GET".into(),
            url: "http://127.0.0.1:1/".into(),
            headers: Default::default(),
            body: None,
        })
        .await
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.starts_with("http error:"), "got: {msg}");
        assert!(!msg.contains("127.0.0.1:1"), "URL must be stripped from error: {msg}");
    }

    #[tokio::test]
    async fn bad_url_maps_to_http_error() {
        let client = Client::builder().build().unwrap();
        let err = send(&client, HttpRequest {
            method: "GET".into(),
            url: "ht!tp://not a url".into(),
            headers: Default::default(),
            body: None,
        })
        .await
        .unwrap_err();
        assert!(err.to_string().starts_with("http error:"), "got: {err}");
    }

    #[tokio::test]
    async fn invalid_method_rejected() {
        let client = Client::builder().build().unwrap();
        let err = send(&client, HttpRequest {
            method: "BAD METHOD".into(),
            url: "http://127.0.0.1/".into(),
            headers: Default::default(),
            body: None,
        })
        .await
        .unwrap_err();
        assert!(err.to_string().contains("invalid method"), "got: {err}");
    }
}
