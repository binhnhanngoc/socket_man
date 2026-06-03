// Thin Tauri command handlers — they adapt the IPC surface onto the WS/HTTP/storage
// layers. Real work lives in `ws::manager`, `http::client`, and `storage::*`.
//
// SECRET RESOLUTION (Phase 5): the outbound commands (ws_connect / ws_send / http_send)
// take the active env id + its secret var keys and resolve `{{secretKey}}` tokens
// Rust-side, right here on the way out — so plaintext secrets never enter the JS heap,
// any frame log, history, or IPC response. Non-secret vars were already resolved by the
// frontend; unknown tokens stay literal.
//
// `secret_get` is intentionally NOT here and never will be (S3) — registering it would
// expose secret reads to webview JS/XSS. Resolution uses the PRIVATE `storage::secrets::get`.

use std::collections::BTreeMap;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppError;
use crate::http::client::HttpClient;
use crate::http::types::{HttpRequest, HttpResponse};
use crate::storage::resolve::{resolve_secrets, resolve_secrets_into, SecretCtx};
use crate::storage::{history, secrets, store, StorageManager};
use crate::ws::manager::WsManager;
use crate::ws::types::{ChannelMsg, ConnectConfig};

// ---- WS ----

#[tauri::command]
pub async fn ws_connect(
    mut config: ConnectConfig,
    env_id: Option<String>,
    secret_keys: Option<Vec<String>>,
    channel: Channel<ChannelMsg>,
    manager: State<'_, WsManager>,
) -> Result<String, AppError> {
    // Resolve secret tokens in the URL + header values before the upgrade request.
    // Resolved values are baked into the stored config so reconnects reuse them.
    if let (Some(env_id), Some(keys)) = (env_id.as_deref(), secret_keys.as_ref()) {
        if !keys.is_empty() {
            // Collect every resolved secret value so the supervisor can scrub it from
            // any connect-error/reason string (a URL/header secret must not leak back).
            let mut used: Vec<String> = Vec::new();
            config.url = resolve_secrets_into(&config.url, env_id, keys, SecretCtx::Url, &mut used)?;
            let mut headers = BTreeMap::new();
            for (k, v) in &config.headers {
                headers.insert(k.clone(), resolve_secrets_into(v, env_id, keys, SecretCtx::Header, &mut used)?);
            }
            config.headers = headers;
            config.redact = used;
        }
    }
    manager
        .connect(config, move |msg| {
            let _ = channel.send(msg);
        })
        .await
}

#[tauri::command]
pub async fn ws_disconnect(conn_id: String, manager: State<'_, WsManager>) -> Result<(), AppError> {
    manager.disconnect(&conn_id).await
}

#[tauri::command]
pub async fn ws_send(
    conn_id: String,
    payload: String,
    env_id: Option<String>,
    secret_keys: Option<Vec<String>>,
    manager: State<'_, WsManager>,
) -> Result<(), AppError> {
    // wire = secret-resolved (goes on the socket); the original payload is the template
    // (secret tokens still literal) recorded in the out-frame log.
    let wire = resolve_payload(payload.clone(), env_id.as_deref(), secret_keys.as_ref(), SecretCtx::Body)?;
    manager.send(&conn_id, wire, payload).await
}

// ---- HTTP ----

#[tauri::command]
pub async fn http_send(
    mut req: HttpRequest,
    env_id: Option<String>,
    secret_keys: Option<Vec<String>>,
    client: State<'_, HttpClient>,
) -> Result<HttpResponse, AppError> {
    if let (Some(env_id), Some(keys)) = (env_id.as_deref(), secret_keys.as_ref()) {
        if !keys.is_empty() {
            req.url = resolve_secrets(&req.url, env_id, keys, SecretCtx::Url)?;
            let mut headers = BTreeMap::new();
            for (k, v) in &req.headers {
                headers.insert(k.clone(), resolve_secrets(v, env_id, keys, SecretCtx::Header)?);
            }
            req.headers = headers;
            if let Some(body) = req.body.take() {
                req.body = Some(resolve_secrets(&body, env_id, keys, SecretCtx::Body)?);
            }
        }
    }
    crate::http::client::send(&client.0, req).await
}

// ---- storage / secrets / history ----

#[tauri::command]
pub async fn storage_load(name: String, storage: State<'_, StorageManager>) -> Result<Value, AppError> {
    store::load(&storage.dir, &name).await
}

#[tauri::command]
pub async fn storage_save(name: String, data: Value, storage: State<'_, StorageManager>) -> Result<(), AppError> {
    let lock = storage.lock_for(&name);
    let _g = lock.lock().await;
    store::save(&storage.dir, &name, &data).await
}

#[tauri::command]
pub async fn history_append(entry: Value, storage: State<'_, StorageManager>) -> Result<(), AppError> {
    let lock = storage.lock_for("history");
    let _g = lock.lock().await;
    history::append(&storage.dir, entry).await
}

#[tauri::command]
pub fn secret_set(env_id: String, key: String, value: String) -> Result<(), AppError> {
    secrets::set(&env_id, &key, &value)
}

#[tauri::command]
pub fn secret_delete(env_id: String, key: String) -> Result<(), AppError> {
    secrets::delete(&env_id, &key)
}

// ---- export ----

// Write text to a user-picked path. The path comes from the dialog plugin's
// `save()` (chosen by the user in JS); this command performs the write so no
// fs-plugin scope has to be granted — the only writable location is whatever the
// user just selected. Callers pass TEMPLATE content only (secret tokens stay
// `{{token}}`); resolved secret values never reach this command. The error carries
// the IO Display (path/reason) only — never the file contents.
#[tauri::command]
pub async fn export_write(path: String, contents: String) -> Result<(), AppError> {
    tokio::fs::write(&path, contents)
        .await
        .map_err(|e| AppError::Storage(e.to_string()))
}

// ---- helpers ----

fn resolve_payload(
    payload: String,
    env_id: Option<&str>,
    secret_keys: Option<&Vec<String>>,
    ctx: SecretCtx,
) -> Result<String, AppError> {
    match (env_id, secret_keys) {
        (Some(env_id), Some(keys)) if !keys.is_empty() => resolve_secrets(&payload, env_id, keys, ctx),
        _ => Ok(payload),
    }
}
