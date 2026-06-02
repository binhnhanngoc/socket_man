// HTTP IPC contract — Rust mirror of the `HttpRequest`/`HttpResponse` interfaces in
// `src/transport/transport.ts`. Field names serialize (camelCase) to exactly those
// TS interfaces. Headers use `BTreeMap<String,String>` to match the WS `ConnectConfig`
// precedent (a JS `Record<string,string>` → ordered map; duplicate header names — rare
// on requests — collapse, which is acceptable for a v1 workbench).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::ws::types::is_sensitive_header;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

// Redacting Debug (mirrors ConnectConfig, F13): a stray `{:?}` must never print an
// Authorization/Cookie value.
impl std::fmt::Debug for HttpRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let masked: BTreeMap<&str, &str> = self
            .headers
            .iter()
            .map(|(k, v)| (k.as_str(), if is_sensitive_header(k) { "***" } else { v.as_str() }))
            .collect();
        f.debug_struct("HttpRequest")
            .field("method", &self.method)
            .field("url", &self.url)
            .field("headers", &masked)
            .field("has_body", &self.body.is_some())
            .finish()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    /// Total elapsed send→body-read in ms (TTFB is out of scope for v1).
    pub timing_ms: u64,
    /// Bytes of the response body actually captured (after the read cap).
    pub size_bytes: u64,
}
