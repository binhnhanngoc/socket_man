// WsManager — owns the connection map and the stable connId counter, and supervises
// each connection's task.
//
// Channel ownership is HOISTED here (F4): the manager creates `(tx, rx)` BEFORE
// connecting, stores `tx` in the `ConnHandle`, and lends `&mut rx` to the connection
// loop. So `tx`/`rx`/`connId` outlive any single socket — the precondition for a
// Phase 3 reconnect that keeps delivering queued sends.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

use super::connection::{run_connection, status_connected};
use super::request::build_request;
use super::types::{ChannelMsg, ConnId, ConnStatus, ConnStatusKind, ConnectConfig};
use crate::error::AppError;

const SEND_BUFFER: usize = 256;

struct ConnHandle {
    tx: mpsc::Sender<Message>,
}

#[derive(Default)]
pub struct WsManager {
    conns: Arc<Mutex<HashMap<ConnId, ConnHandle>>>,
    next_id: AtomicU64,
}

impl WsManager {
    /// Open a connection. `emit` is the per-connection sink (the Tauri `Channel` in
    /// production). Returns the stable connId immediately; status + frames stream
    /// over `emit` from the spawned supervisor.
    pub async fn connect<E>(&self, cfg: ConnectConfig, emit: E) -> Result<ConnId, AppError>
    where
        E: Fn(ChannelMsg) + Send + Sync + 'static,
    {
        // Validate URL/scheme up front so the webview gets a synchronous rejection
        // for a malformed URL instead of an async status flap.
        build_request(&cfg)?;

        let conn_id = (self.next_id.fetch_add(1, Ordering::Relaxed) + 1).to_string();
        let (tx, rx) = mpsc::channel::<Message>(SEND_BUFFER);
        self.conns.lock().await.insert(conn_id.clone(), ConnHandle { tx });

        let conns = self.conns.clone();
        let id = conn_id.clone();
        tauri::async_runtime::spawn(async move {
            supervise(cfg, rx, emit, id.clone()).await;
            // Self-cleanup: drop the handle once the task exits so the map never grows.
            conns.lock().await.remove(&id);
        });

        Ok(conn_id)
    }

    pub async fn send(&self, conn_id: &str, payload: String) -> Result<(), AppError> {
        let conns = self.conns.lock().await;
        let handle = conns.get(conn_id).ok_or(AppError::UnknownConn)?;
        handle.tx.send(Message::Text(payload.into())).await.map_err(|e| AppError::Send(e.to_string()))
    }

    /// Graceful disconnect: drop the sender so the loop's `rx.recv()` returns `None`
    /// and the task closes the socket cleanly. The supervisor's self-cleanup removes
    /// the (already-removed) entry harmlessly.
    pub async fn disconnect(&self, conn_id: &str) -> Result<(), AppError> {
        self.conns.lock().await.remove(conn_id);
        Ok(())
    }

    pub async fn conn_count(&self) -> usize {
        self.conns.lock().await.len()
    }

    /// Synchronous teardown for window-close (drops every sender → all tasks exit).
    pub fn shutdown_all(&self) {
        self.conns.blocking_lock().clear();
    }
}

fn disconnected(conn_id: &str, reason: Option<String>, code: Option<u16>) -> ConnStatus {
    let mut s = ConnStatus::new(conn_id, ConnStatusKind::Disconnected);
    s.reason = reason;
    s.code = code;
    s
}

/// Scrub any secret header VALUE out of an outbound message so a token can never ride
/// an error/reason string back to the webview, even if some lower layer echoed it.
fn scrub(mut s: String, cfg: &ConnectConfig) -> String {
    for (name, value) in &cfg.headers {
        if super::types::is_sensitive_header(name) && !value.is_empty() {
            s = s.replace(value.as_str(), "***");
        }
    }
    s
}

async fn supervise<E>(cfg: ConnectConfig, mut rx: mpsc::Receiver<Message>, emit: E, conn_id: ConnId)
where
    E: Fn(ChannelMsg) + Send + Sync + 'static,
{
    emit(ChannelMsg::Status { status: ConnStatus::new(&conn_id, ConnStatusKind::Connecting) });

    // Validated in `connect`, so this only fails on a transient parse edge — treat as
    // a connect failure.
    let request = match build_request(&cfg) {
        Ok(r) => r,
        Err(e) => {
            let msg = scrub(e.to_string(), &cfg);
            emit(ChannelMsg::Error { message: msg.clone(), code: None });
            emit(ChannelMsg::Status { status: disconnected(&conn_id, Some(msg), None) });
            return;
        }
    };

    match tokio_tungstenite::connect_async(request).await {
        Ok((ws, _resp)) => {
            emit(ChannelMsg::Status { status: status_connected(&conn_id) });
            let outcome = run_connection(ws, &mut rx, |m| emit(m)).await;
            let reason = outcome.reason.map(|r| scrub(r, &cfg));
            emit(ChannelMsg::Status { status: disconnected(&conn_id, reason, outcome.code) });
        }
        Err(e) => {
            let msg = scrub(e.to_string(), &cfg);
            emit(ChannelMsg::Error { message: msg.clone(), code: None });
            emit(ChannelMsg::Status { status: disconnected(&conn_id, Some(msg), None) });
        }
    }
}
