// The connection loop — a SINGLE task running `select!` over the socket read half,
// the command receiver, the heartbeat tick, the coalesce-flush tick, and a cancel
// signal. Keeping both socket halves in ONE task (no cross-task `.split()`) avoids
// the rustls split read+write deadlock and lets the heartbeat/coalesce timers share
// the same loop as reads and writes.
//
// `run_connection` borrows `&mut rx` rather than owning it, so the receiver (and the
// stable connId, and the `tx` held by the manager) SURVIVE a socket swap — that is
// what lets the supervisor reconnect and keep delivering queued sends.
//
// Three reliability behaviours live here (Phase 3):
//   - Heartbeat: an outbound ping every `heartbeat` interval; a missed pong by the
//     next tick is the dead-socket signal (see `heartbeat.rs`).
//   - Coalescing: inbound/outbound frames accumulate in a bounded batch flushed on
//     the coalesce timer or at the cap, so a high-rate stream doesn't flood IPC.
//   - Ordering (flush-before-status): the pending batch is flushed BEFORE any status
//     is emitted, so the frontend never sees frames out of order with status.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio::time::{interval_at, Instant, MissedTickBehavior};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::cancel::Cancel;
use super::heartbeat::{encode_ping, rtt_from_pong, Heartbeat, HeartbeatTick};
use super::types::{ChannelMsg, ConnId, ConnStatus, ConnStatusKind, Frame, FrameDir};

// Largest inbound batch flushed in one IPC message (F: bounded buffer).
const FRAME_BATCH_CAP: usize = 256;

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

/// Flush the pending frame batch as ONE `Frames` message, then clear it. No-op on an
/// empty batch. Called on the coalesce tick, at the cap, and — critically — before
/// any status is emitted so the channel's order matches logical order.
fn flush_batch<E: FnMut(ChannelMsg)>(batch: &mut Vec<Frame>, emit: &mut E) {
    if !batch.is_empty() {
        emit(ChannelMsg::Frames { batch: std::mem::take(batch) });
    }
}

/// How a connection ended — the supervisor uses this to decide reconnect vs. teardown.
#[derive(Default)]
pub struct ConnOutcome {
    pub reason: Option<String>,
    pub code: Option<u16>,
}

/// Why `run_connection` returned. `Cancelled` is terminal (explicit disconnect or all
/// senders dropped) → no reconnect. `Dropped` is an unexpected loss (read error, dead
/// socket, server close) → the supervisor may reconnect.
pub enum RunEnd {
    Cancelled,
    Dropped(ConnOutcome),
}

/// Per-socket run parameters. `heartbeat`/`coalesce` are `Duration` (not the config's
/// whole-second `heartbeat_secs`) so tests can drive sub-second timers directly.
pub struct RunParams {
    pub conn_id: ConnId,
    pub heartbeat: Duration,
    pub coalesce: Duration,
    pub cancel: Cancel,
}

/// Drive one socket until it closes/errors, the command sender is dropped, the
/// heartbeat detects a dead peer, or the connection is cancelled. `emit` is the sink
/// for channel messages (the Tauri `Channel` in production, a Vec collector in tests).
/// Generic over the stream so the same loop runs over `ws://` and TLS `wss://`.
pub async fn run_connection<S, E>(
    mut ws: WebSocketStream<S>,
    rx: &mut mpsc::Receiver<Message>,
    emit: &mut E,
    params: &RunParams,
) -> RunEnd
where
    S: AsyncRead + AsyncWrite + Unpin,
    E: FnMut(ChannelMsg),
{
    let mut hb = Heartbeat::new();
    let mut batch: Vec<Frame> = Vec::new();

    // `interval_at(now + period, …)` so the FIRST tick is one period out, not
    // immediate — no ping fires the instant we connect, no empty flush at t=0.
    let mut ping_tick = interval_at(Instant::now() + params.heartbeat, params.heartbeat);
    ping_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut coalesce_tick = interval_at(Instant::now() + params.coalesce, params.coalesce);
    coalesce_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            incoming = ws.next() => match incoming {
                Some(Ok(Message::Text(t))) => {
                    batch.push(make_frame(FrameDir::In, t.as_str(), "message"));
                    if batch.len() >= FRAME_BATCH_CAP {
                        flush_batch(&mut batch, emit);
                    }
                }
                Some(Ok(Message::Pong(payload))) => {
                    if let Some(rtt) = rtt_from_pong(payload.as_ref(), now_ms()) {
                        hb.on_pong();
                        // Flush pending frames THEN emit status (ordering contract).
                        flush_batch(&mut batch, emit);
                        emit(ChannelMsg::Status { status: status_rtt(&params.conn_id, rtt) });
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    let (reason, code) = frame
                        .map(|f| (f.reason.to_string(), Some(u16::from(f.code))))
                        .unwrap_or_else(|| ("server closed".to_string(), None));
                    batch.push(sys_frame(&reason, code));
                    flush_batch(&mut batch, emit);
                    return RunEnd::Dropped(ConnOutcome { reason: Some(reason), code });
                }
                // Binary frames are out of scope in v1; inbound Ping is auto-answered
                // by the tungstenite stream itself.
                Some(Ok(_)) => {}
                Some(Err(e)) => {
                    flush_batch(&mut batch, emit);
                    return RunEnd::Dropped(ConnOutcome { reason: Some(e.to_string()), code: None });
                }
                None => {
                    flush_batch(&mut batch, emit);
                    return RunEnd::Dropped(ConnOutcome { reason: Some("stream ended".into()), code: None });
                }
            },
            _ = ping_tick.tick() => match hb.on_tick() {
                // The previous pong never arrived ⇒ dead socket → supervisor reconnects.
                HeartbeatTick::Dead => {
                    flush_batch(&mut batch, emit);
                    return RunEnd::Dropped(ConnOutcome { reason: Some("heartbeat timeout".into()), code: None });
                }
                HeartbeatTick::SendPing => {
                    if ws.send(Message::Ping(Bytes::from(encode_ping(now_ms())))).await.is_err() {
                        flush_batch(&mut batch, emit);
                        return RunEnd::Dropped(ConnOutcome { reason: Some("ping send failed".into()), code: None });
                    }
                }
            },
            cmd = rx.recv() => match cmd {
                Some(message) => {
                    if let Message::Text(t) = &message {
                        batch.push(make_frame(FrameDir::Out, t.as_str(), "message"));
                    }
                    if ws.send(message).await.is_err() {
                        flush_batch(&mut batch, emit);
                        return RunEnd::Dropped(ConnOutcome { reason: Some("send failed".into()), code: None });
                    }
                }
                // All senders dropped (window close) → graceful close, terminal.
                None => {
                    graceful_close(&mut ws, &mut batch, emit).await;
                    return RunEnd::Cancelled;
                }
            },
            _ = coalesce_tick.tick() => flush_batch(&mut batch, emit),
            // Explicit disconnect — instant, even on an idle connected socket (F7).
            _ = params.cancel.cancelled() => {
                graceful_close(&mut ws, &mut batch, emit).await;
                return RunEnd::Cancelled;
            }
        }
    }
}

/// Send a normal close frame and flush a final sys frame. Used by both terminal
/// paths (cancel / all-senders-dropped).
async fn graceful_close<S, E>(ws: &mut WebSocketStream<S>, batch: &mut Vec<Frame>, emit: &mut E)
where
    S: AsyncRead + AsyncWrite + Unpin,
    E: FnMut(ChannelMsg),
{
    let close = tokio_tungstenite::tungstenite::protocol::CloseFrame {
        code: CloseCode::Normal,
        reason: "client disconnect".into(),
    };
    let _ = ws.send(Message::Close(Some(close))).await;
    batch.push(sys_frame("client disconnect", Some(1000)));
    flush_batch(batch, emit);
}

/// `connected` status payload with a fresh `connected_at` — the supervisor emits this
/// once per successful (re)connect.
pub fn status_connected(conn_id: &str) -> ConnStatus {
    let mut s = ConnStatus::new(conn_id, ConnStatusKind::Connected);
    s.connected_at = Some(now_ms());
    s
}

/// `connected` status carrying a heartbeat RTT. `connected_at` is intentionally left
/// `None`: this rides on top of the already-connected state and must NOT reset the
/// frontend's connection timer.
fn status_rtt(conn_id: &str, rtt_ms: u64) -> ConnStatus {
    let mut s = ConnStatus::new(conn_id, ConnStatusKind::Connected);
    s.rtt_ms = Some(rtt_ms);
    s
}
