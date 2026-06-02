// WS IPC contract — Rust mirror of `src/transport/transport.ts`. Field names here
// serialize (camelCase) to exactly the TS interface the frontend consumes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Runtime identity of a connection. Generated Rust-side once at `ws_connect`
/// (atomic counter → string) and reused as the HashMap key across any internal
/// reconnect. Never copied onto a duplicated UI item.
pub type ConnId = String;

/// Header names whose VALUES must never be printed (Debug) or leaked into errors.
const SENSITIVE_HEADERS: &[&str] = &["authorization", "cookie", "proxy-authorization"];

pub fn is_sensitive_header(name: &str) -> bool {
    SENSITIVE_HEADERS.contains(&name.to_ascii_lowercase().as_str())
}

/// Connect config from the webview. `headers` includes the custom `Authorization`
/// that goes on the WS upgrade request — the whole reason for a Rust transport.
#[derive(Clone, Deserialize)]
pub struct ConnectConfig {
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

// Redacting Debug (F13): masks Authorization/Cookie/Proxy-Authorization values so a
// stray `{:?}` in a log or error can never expose a token.
impl std::fmt::Debug for ConnectConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let masked: BTreeMap<&str, &str> = self
            .headers
            .iter()
            .map(|(k, v)| (k.as_str(), if is_sensitive_header(k) { "***" } else { v.as_str() }))
            .collect();
        f.debug_struct("ConnectConfig").field("url", &self.url).field("headers", &masked).finish()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameDir {
    In,
    Out,
    Sys,
}

#[derive(Clone, Debug, Serialize)]
pub struct Frame {
    pub id: u64,
    pub dir: FrameDir,
    pub kind: String,
    pub body: serde_json::Value,
    pub ts: u64,
    pub size: u64,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnStatusKind {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnStatus {
    pub conn_id: ConnId,
    pub status: ConnStatusKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u64>,
}

impl ConnStatus {
    pub fn new(conn_id: &str, status: ConnStatusKind) -> Self {
        ConnStatus { conn_id: conn_id.to_string(), status, connected_at: None, reason: None, code: None, rtt_ms: None }
    }
}

/// Single tagged payload carried over the per-connection `ipc::Channel`. Supersedes
/// the brainstorm's separate `ws://frame`/`ws://status`/`ws://error` emit events;
/// `Error` is the `ws://error` replacement (F25).
#[derive(Clone, Serialize)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ChannelMsg {
    Frames { batch: Vec<Frame> },
    Status { status: ConnStatus },
    Error { message: String, #[serde(skip_serializing_if = "Option::is_none")] code: Option<u16> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_masks_secret_header_values() {
        let mut headers = BTreeMap::new();
        headers.insert("Authorization".to_string(), "Bearer super-secret-token".to_string());
        headers.insert("X-Plant-Id".to_string(), "lehigh-valley".to_string());
        let cfg = ConnectConfig { url: "wss://x/".into(), headers };
        let printed = format!("{cfg:?}");
        assert!(!printed.contains("super-secret-token"), "token leaked in Debug: {printed}");
        assert!(printed.contains("***"));
        assert!(printed.contains("lehigh-valley"), "non-secret header should stay visible");
    }

    #[test]
    fn channel_msg_serializes_with_camelcase_tag() {
        let s = ConnStatus { conn_id: "1".into(), status: ConnStatusKind::Connected, connected_at: Some(42), reason: None, code: None, rtt_ms: None };
        let json = serde_json::to_string(&ChannelMsg::Status { status: s }).unwrap();
        assert!(json.contains("\"t\":\"status\""), "{json}");
        assert!(json.contains("\"connId\":\"1\""), "{json}");
        assert!(json.contains("\"connectedAt\":42"), "{json}");
    }
}
