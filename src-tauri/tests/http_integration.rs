// Phase 4 HTTP client integration tests, driven against a raw tokio HTTP/1.1 echo
// server (no axum/hyper-server dependency — keeps the dep graph lean, F26). A SINGLE
// parameterized route reflects method + headers + body as JSON, with query knobs:
//   ?status=NNN   -> respond with that status code
//   ?sleep=ms     -> delay before responding (drives the timeout test)
//   ?ctype=text   -> respond as text/plain instead of application/json

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::Client;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use socketman_lib::http::client::send;
use socketman_lib::http::types::HttpRequest;

// ---- echo server ----

async fn spawn_echo() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            tokio::spawn(async move { handle_one(&mut sock).await });
        }
    });
    format!("http://{addr}")
}

async fn handle_one(sock: &mut TcpStream) {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    let header_end = loop {
        let n = match sock.read(&mut tmp).await {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 64 * 1024 {
            return;
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut req_parts = lines.next().unwrap_or("").split_whitespace();
    let method = req_parts.next().unwrap_or("").to_string();
    let target = req_parts.next().unwrap_or("/").to_string();

    let mut req_headers: BTreeMap<String, String> = BTreeMap::new();
    let mut content_length = 0usize;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim().to_ascii_lowercase();
            let v = v.trim().to_string();
            if k == "content-length" {
                content_length = v.parse().unwrap_or(0);
            }
            req_headers.insert(k, v);
        }
    }

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        match sock.read(&mut tmp).await {
            Ok(0) | Err(_) => break,
            Ok(n) => body.extend_from_slice(&tmp[..n]),
        }
    }
    let body_str = String::from_utf8_lossy(&body[..content_length.min(body.len())]).to_string();

    // Query knobs.
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let mut status = 200u16;
    let mut sleep_ms = 0u64;
    let mut ctype = "application/json";
    for kv in query.split('&') {
        match kv.split_once('=') {
            Some(("status", v)) => status = v.parse().unwrap_or(200),
            Some(("sleep", v)) => sleep_ms = v.parse().unwrap_or(0),
            Some(("ctype", "text")) => ctype = "text/plain",
            _ => {}
        }
    }
    if sleep_ms > 0 {
        tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
    }

    let resp_body = if ctype == "text/plain" {
        format!("method={method} path={path} body={body_str}")
    } else {
        let headers_json = req_headers
            .iter()
            .map(|(k, v)| format!("{}:{}", json_str(k), json_str(v)))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"method\":{},\"path\":{},\"headers\":{{{}}},\"body\":{}}}",
            json_str(&method),
            json_str(path),
            headers_json,
            json_str(&body_str)
        )
    };

    let reason = match status {
        200 => "OK",
        201 => "Created",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Status",
    };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{resp_body}",
        resp_body.as_bytes().len()
    );
    let _ = sock.write_all(resp.as_bytes()).await;
    let _ = sock.flush().await;
}

fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn req(method: &str, url: String, headers: &[(&str, &str)], body: Option<&str>) -> HttpRequest {
    HttpRequest {
        method: method.to_string(),
        url,
        headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        body: body.map(|b| b.to_string()),
    }
}

// ---- tests ----

#[tokio::test]
async fn get_reflects_method_status_and_captured_headers() {
    let base = spawn_echo().await;
    let client = Client::builder().build().unwrap();
    let resp = send(&client, req("GET", format!("{base}/"), &[("Authorization", "Bearer tok-123"), ("X-Plant-Id", "valley")], None))
        .await
        .unwrap();

    assert_eq!(resp.status, 200);
    assert_eq!(resp.status_text, "OK");
    assert!(resp.body.contains("\"method\":\"GET\""), "body: {}", resp.body);
    // The echo server reflects the request headers it received — proving our client sent them.
    assert!(resp.body.contains("authorization"), "auth header not seen by server: {}", resp.body);
    assert!(resp.body.contains("Bearer tok-123"), "auth value not sent: {}", resp.body);
    assert!(resp.body.contains("x-plant-id"));
    // sizeBytes equals the captured (ASCII) body length.
    assert_eq!(resp.size_bytes as usize, resp.body.len());
    assert!(resp.headers.get("content-type").is_some());
}

#[tokio::test]
async fn post_reflects_body() {
    let base = spawn_echo().await;
    let client = Client::builder().build().unwrap();
    let payload = "{\"hello\":\"world\"}";
    let resp = send(&client, req("POST", format!("{base}/submit"), &[("Content-Type", "application/json")], Some(payload)))
        .await
        .unwrap();

    assert_eq!(resp.status, 200);
    assert!(resp.body.contains("\"method\":\"POST\""), "body: {}", resp.body);
    assert!(resp.body.contains("hello"), "request body not echoed: {}", resp.body);
}

#[tokio::test]
async fn status_query_param_yields_404() {
    let base = spawn_echo().await;
    let client = Client::builder().build().unwrap();
    let resp = send(&client, req("GET", format!("{base}/missing?status=404"), &[], None)).await.unwrap();
    assert_eq!(resp.status, 404);
    assert_eq!(resp.status_text, "Not Found");
}

#[tokio::test]
async fn non_json_content_type_returns_text() {
    let base = spawn_echo().await;
    let client = Client::builder().build().unwrap();
    let resp = send(&client, req("GET", format!("{base}/?ctype=text"), &[], None)).await.unwrap();
    assert_eq!(resp.status, 200);
    assert_eq!(resp.headers.get("content-type").map(String::as_str), Some("text/plain"));
    assert!(resp.body.starts_with("method=GET"), "text body: {}", resp.body);
}

#[tokio::test]
async fn timing_reflects_server_delay() {
    let base = spawn_echo().await;
    let client = Client::builder().build().unwrap();
    let resp = send(&client, req("GET", format!("{base}/?sleep=300"), &[], None)).await.unwrap();
    assert!(resp.timing_ms >= 250, "timing should reflect the 300ms server delay, got {}", resp.timing_ms);
}

#[tokio::test]
async fn short_timeout_against_slow_server_errors() {
    let base = spawn_echo().await;
    let client = Client::builder().timeout(Duration::from_millis(150)).build().unwrap();
    let err = send(&client, req("GET", format!("{base}/?sleep=1500"), &[], None)).await.unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("timed out"), "expected timeout error, got: {msg}");
}
