// The connection loop — a SINGLE task running `select!` over the socket read half
// and the command receiver. Both socket halves stay in ONE task (no cross-task
// `.split()`), which avoids the rustls split read+write deadlock and is the exact
// shape Phase 3 extends (heartbeat tick / pong deadline / coalesce flush).
//
// `run_connection` borrows `&mut rx` rather than owning it, so the receiver (and the
// stable connId, and the `tx` held by the manager) SURVIVE a socket swap — that is
// what makes a Phase 3 reconnect able to keep delivering queued sends.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::types::{ChannelMsg, ConnStatus, Frame, FrameDir};

// Process-global frame id sequence — ids are unique across all connections.
static FRAME_SEQ: AtomicU64 = AtomicU64::new(0);

fn next_frame_id() -> u64 {
    FRAME_SEQ.fetch_add(1, Ordering::Relaxed) + 1
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn body_value(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|_| serde_json::Value::String(text.to_string()))
}

fn make_frame(dir: FrameDir, text: &str, default_kind: &str) -> Frame {
    let body = body_value(text);
    let kind = body
        .get("action")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| default_kind.to_string());
    Frame { id: next_frame_id(), dir, kind, body, ts: now_ms(), size: text.len() as u64 }
}

fn sys_frame(reason: &str, code: Option<u16>) -> Frame {
    Frame {
        id: next_frame_id(),
        dir: FrameDir::Sys,
        kind: "closed".into(),
        body: serde_json::json!({ "reason": reason, "code": code }),
        ts: now_ms(),
        size: reason.len() as u64,
    }
}

/// How a connection ended — the supervisor uses this to emit the final
/// `disconnected` status.
#[derive(Default)]
pub struct ConnOutcome {
    pub reason: Option<String>,
    pub code: Option<u16>,
}

/// Drive one socket until it closes/errors or the command sender is dropped.
/// `emit` is the sink for channel messages (the Tauri `Channel` in production, a
/// Vec collector in tests). Generic over the stream so the same loop is exercised
/// over plain `ws://` and TLS `wss://` in tests.
pub async fn run_connection<S, E>(
    mut ws: WebSocketStream<S>,
    rx: &mut mpsc::Receiver<Message>,
    mut emit: E,
) -> ConnOutcome
where
    S: AsyncRead + AsyncWrite + Unpin,
    E: FnMut(ChannelMsg),
{
    loop {
        tokio::select! {
            incoming = ws.next() => match incoming {
                Some(Ok(Message::Text(t))) => {
                    emit(ChannelMsg::Frames { batch: vec![make_frame(FrameDir::In, t.as_str(), "message")] });
                }
                Some(Ok(Message::Close(frame))) => {
                    let (reason, code) = frame
                        .map(|f| (f.reason.to_string(), Some(u16::from(f.code))))
                        .unwrap_or_else(|| ("server closed".to_string(), None));
                    emit(ChannelMsg::Frames { batch: vec![sys_frame(&reason, code)] });
                    return ConnOutcome { reason: Some(reason), code };
                }
                // Binary frames are out of scope in v1; ping/pong/raw frames are
                // handled by the tungstenite stream itself.
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    emit(ChannelMsg::Error { message: e.to_string(), code: None });
                    return ConnOutcome { reason: Some(e.to_string()), code: None };
                }
                None => return ConnOutcome { reason: Some("stream ended".into()), code: None },
            },
            cmd = rx.recv() => match cmd {
                Some(message) => {
                    if let Message::Text(t) = &message {
                        emit(ChannelMsg::Frames { batch: vec![make_frame(FrameDir::Out, t.as_str(), "message")] });
                    }
                    if ws.send(message).await.is_err() {
                        return ConnOutcome { reason: Some("send failed".into()), code: None };
                    }
                }
                // All senders dropped (ws_disconnect / window close) → graceful close.
                None => {
                    let close = tokio_tungstenite::tungstenite::protocol::CloseFrame {
                        code: CloseCode::Normal,
                        reason: "client disconnect".into(),
                    };
                    let _ = ws.send(Message::Close(Some(close))).await;
                    emit(ChannelMsg::Frames { batch: vec![sys_frame("client disconnect", Some(1000))] });
                    return ConnOutcome { reason: Some("client disconnect".into()), code: Some(1000) };
                }
            },
        }
    }
}

/// Build a `connecting`/`connected`/`disconnected` status payload helper used by the
/// supervisor (kept here so frame-id/time helpers stay private to this module).
pub fn status_connected(conn_id: &str) -> ConnStatus {
    let mut s = ConnStatus::new(conn_id, super::types::ConnStatusKind::Connected);
    s.connected_at = Some(now_ms());
    s
}
