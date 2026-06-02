// Thin Tauri command handlers — they only adapt the IPC surface (managed state +
// the per-connection `ipc::Channel`) onto the `WsManager` API. All real work lives
// in `ws::manager`/`ws::connection`.
//
// NOTE: `secret_get` is intentionally NOT here and never will be — registering it
// would expose secret resolution to webview JS/XSS. Secret `{{token}}` substitution
// happens Rust-side on the outbound path only (Phase 5).

use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppError;
use crate::ws::manager::WsManager;
use crate::ws::types::{ChannelMsg, ConnectConfig};

#[tauri::command]
pub async fn ws_connect(
    config: ConnectConfig,
    channel: Channel<ChannelMsg>,
    manager: State<'_, WsManager>,
) -> Result<String, AppError> {
    // The Channel is cheaply cloneable (Arc inside); move it into the emit closure.
    manager.connect(config, move |msg| {
        let _ = channel.send(msg);
    })
    .await
}

#[tauri::command]
pub async fn ws_disconnect(conn_id: String, manager: State<'_, WsManager>) -> Result<(), AppError> {
    manager.disconnect(&conn_id).await
}

#[tauri::command]
pub async fn ws_send(conn_id: String, payload: String, manager: State<'_, WsManager>) -> Result<(), AppError> {
    manager.send(&conn_id, payload).await
}
