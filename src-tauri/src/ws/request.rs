// build_request — turns a ConnectConfig into a tungstenite client handshake request
// carrying the caller's custom headers verbatim on the upgrade. This is the single
// capability that justified the Rust backend (the browser WebSocket API cannot set
// upgrade headers), so it gets a dedicated unit test.

use tokio_tungstenite::tungstenite::client::{ClientRequestBuilder, IntoClientRequest};
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::Uri;

use super::types::ConnectConfig;
use crate::error::AppError;

pub fn build_request(cfg: &ConnectConfig) -> Result<Request, AppError> {
    let uri: Uri = cfg.url.parse().map_err(|_| AppError::InvalidUrl(cfg.url.clone()))?;
    match uri.scheme_str() {
        Some("ws") | Some("wss") => {}
        _ => return Err(AppError::InvalidUrl(format!("scheme must be ws:// or wss:// ({})", cfg.url))),
    }
    let mut builder = ClientRequestBuilder::new(uri);
    for (key, value) in &cfg.headers {
        builder = builder.with_header(key.clone(), value.clone());
    }
    builder.into_client_request().map_err(|e| AppError::Connect(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn cfg(url: &str, pairs: &[(&str, &str)]) -> ConnectConfig {
        let headers = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<BTreeMap<_, _>>();
        ConnectConfig { url: url.into(), headers }
    }

    #[test]
    fn carries_custom_headers_and_uri_verbatim() {
        let req = build_request(&cfg(
            "wss://app.example.io/socket",
            &[
                ("Authorization", "Bearer atk_live_8f2a"),
                ("Sec-WebSocket-Protocol", "relay.v3"),
                ("Origin", "https://app.example.io"),
                ("X-Plant-Id", "lehigh-valley"),
            ],
        ))
        .expect("request builds");

        assert_eq!(req.uri().to_string(), "wss://app.example.io/socket");
        assert_eq!(req.headers().get("authorization").unwrap(), "Bearer atk_live_8f2a");
        assert_eq!(req.headers().get("sec-websocket-protocol").unwrap(), "relay.v3");
        assert_eq!(req.headers().get("origin").unwrap(), "https://app.example.io");
        assert_eq!(req.headers().get("x-plant-id").unwrap(), "lehigh-valley");
    }

    #[test]
    fn rejects_non_ws_schemes() {
        assert!(build_request(&cfg("https://example.io", &[])).is_err());
        assert!(build_request(&cfg("http://example.io", &[])).is_err());
        assert!(build_request(&cfg("not a url", &[])).is_err());
    }

    #[test]
    fn accepts_plain_ws() {
        assert!(build_request(&cfg("ws://127.0.0.1:9001/", &[])).is_ok());
    }
}
