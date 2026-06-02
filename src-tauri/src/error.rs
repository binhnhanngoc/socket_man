// AppError — the single error type returned across the Tauri IPC boundary.
//
// SECURITY: error strings must never embed secret header values (Authorization /
// Cookie tokens). This type is constructed only from underlying error `Display`
// output (which carries the host/scheme, never the request headers we set), and
// the WS supervisor additionally scrubs known secret values out of any message it
// emits (see `ws::manager`). Together those keep tokens out of `AppError`,
// `ConnStatus.reason`, and `ChannelMsg::Error`.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid url: {0}")]
    InvalidUrl(String),
    #[error("connection failed: {0}")]
    Connect(String),
    #[error("unknown connection")]
    UnknownConn,
    #[error("send failed: {0}")]
    Send(String),
    // HTTP transport (Phase 4). Constructed from reqwest error Display with the URL
    // stripped (`without_url`) so a secret resolved into a URL (Phase 5) can't leak.
    #[error("http error: {0}")]
    Http(String),
    // JSON persistence (Phase 5). Carries fs/serde Display only — never file contents.
    #[error("storage error: {0}")]
    Storage(String),
    // Keychain + secret resolution (Phase 5). Constructed from keyring error Display
    // or a validation message — NEVER the secret value itself.
    #[error("secret error: {0}")]
    Secret(String),
}

// Serialize to a plain string so the webview receives `err` as a readable message
// (Tauri rejects the command promise with this value).
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
