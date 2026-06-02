// WsManager — owns the connection map and the stable connId counter, and supervises
// each connection's task.
//
// Channel ownership is HOISTED here (F4): the manager creates `(tx, rx)` BEFORE
// connecting, stores `tx` in the `ConnHandle`, and lends `rx` to the supervising
// reconnect loop. So `tx`/`rx`/`connId` outlive any single socket — the precondition
// for a reconnect that keeps delivering queued sends.
//
// Each handle also holds a `CancellationToken` (F7). `disconnect` fires it so teardown
// is instant whether the socket is idle-connected OR mid-backoff — and never reconnects.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use super::cancel::Cancel;
use super::connection::Outbound;
use super::reconnect::supervise;
use super::request::build_request;
use super::types::{ChannelMsg, ConnId, ConnectConfig};
use crate::error::AppError;

const SEND_BUFFER: usize = 256;

struct ConnHandle {
    tx: mpsc::Sender<Outbound>,
    cancel: Cancel,
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
        let (tx, rx) = mpsc::channel::<Outbound>(SEND_BUFFER);
        let cancel = Cancel::new();
        self.conns.lock().await.insert(conn_id.clone(), ConnHandle { tx, cancel: cancel.clone() });

        let conns = self.conns.clone();
        let id = conn_id.clone();
        tauri::async_runtime::spawn(async move {
            supervise(cfg, rx, emit, id.clone(), cancel).await;
            // Self-cleanup: drop the handle once the task exits so the map never grows.
            conns.lock().await.remove(&id);
        });

        Ok(conn_id)
    }

    /// Queue a text send. `wire` is what goes on the socket (secret-resolved); `log`
    /// is the template recorded in the out-frame (so secrets never reach the log).
    /// For sends with no secrets, pass the same string for both.
    pub async fn send(&self, conn_id: &str, wire: String, log: String) -> Result<(), AppError> {
        let conns = self.conns.lock().await;
        let handle = conns.get(conn_id).ok_or(AppError::UnknownConn)?;
        handle.tx.send(Outbound::text(wire, log)).await.map_err(|e| AppError::Send(e.to_string()))
    }

    /// Explicit disconnect: cancel the token so the supervisor tears down instantly
    /// (even mid-backoff) and stops reconnecting, then drop the handle. The
    /// supervisor's self-cleanup removes the (already-removed) entry harmlessly.
    pub async fn disconnect(&self, conn_id: &str) -> Result<(), AppError> {
        let mut conns = self.conns.lock().await;
        if let Some(handle) = conns.remove(conn_id) {
            handle.cancel.cancel();
        }
        Ok(())
    }

    pub async fn conn_count(&self) -> usize {
        self.conns.lock().await.len()
    }

    /// Synchronous teardown for window-close: cancel every token (so any task mid-
    /// backoff stops reconnecting) and drop every sender, then clear the map.
    pub fn shutdown_all(&self) {
        let mut conns = self.conns.blocking_lock();
        for handle in conns.values() {
            handle.cancel.cancel();
        }
        conns.clear();
    }
}
