// The supervising reconnect loop (F4/F7).
//
// Wraps a single socket's `run_connection` in a loop that, on an unexpected drop,
// emits `reconnecting`, waits a capped exponential backoff, and reconnects — reusing
// the hoisted `(tx, rx)` and the stable connId so queued sends survive the swap. On
// explicit disconnect (the cancel token) it tears down INSTANTLY and never reconnects,
// whether the socket is idle-connected OR mid-backoff:
//
//   - the inner `run_connection` has a `cancel.cancelled()` arm (instant on a live socket);
//   - the backoff wait here is itself a `select!` against `cancel.cancelled()` so a
//     disconnect during a 30s backoff is immediate, not a 30s hang.
//
// Exactly ONE terminal `disconnected` status is emitted per supervisor, on every exit
// path; reconnect-eligible drops emit `reconnecting` instead and loop.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::mpsc;
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;

use super::backoff::ExponentialBackoff;
use super::cancel::Cancel;
use super::connection::{run_connection, status_connected, RunEnd, RunParams};
use super::tls::connect_ws;
use super::types::{is_sensitive_header, ChannelMsg, ConnId, ConnStatus, ConnStatusKind, ConnectConfig};

// Hardcoded inbound-frame coalesce window (F18). Not user-configurable in v1.
const COALESCE: Duration = Duration::from_millis(80);

/// Drive a connection with auto-reconnect until it is cancelled or reconnect is
/// disabled and the socket drops. `emit` is the per-connection sink (the Tauri
/// `Channel` in production, a Vec collector in tests).
pub async fn supervise<E>(
    cfg: ConnectConfig,
    mut rx: mpsc::Receiver<Message>,
    emit: E,
    conn_id: ConnId,
    cancel: Cancel,
) where
    E: Fn(ChannelMsg) + Send + Sync + 'static,
{
    emit(status(&conn_id, ConnStatusKind::Connecting, None, None));

    // `max(1)` floors the cap so a degenerate 0 from config can't busy-loop.
    let mut backoff = ExponentialBackoff::new(cfg.reconnect.max_backoff_secs.max(1));
    let heartbeat = Duration::from_secs(cfg.heartbeat_secs.max(1));

    // One adapter closure reused across reconnect rounds: borrows `emit` so the
    // direct status emits below and `run_connection`'s frame emits share one sink.
    let mut emit_fn = |m: ChannelMsg| emit(m);

    loop {
        if cancel.is_cancelled() {
            emit(status(&conn_id, ConnStatusKind::Disconnected, None, None));
            return;
        }

        // The handshake itself is cancellable: a disconnect during a hanging connect
        // to an unreachable host tears down instantly instead of waiting out the OS
        // connect timeout (and attempts no reconnect).
        let connect_result = tokio::select! {
            r = connect_ws(&cfg) => r,
            _ = cancel.cancelled() => {
                emit(status(&conn_id, ConnStatusKind::Disconnected, None, None));
                return;
            }
        };

        match connect_result {
            Ok(ws) => {
                backoff.reset();
                emit(ChannelMsg::Status { status: status_connected(&conn_id) });
                let params = RunParams {
                    conn_id: conn_id.clone(),
                    heartbeat,
                    coalesce: COALESCE,
                    cancel: cancel.clone(),
                };
                match run_connection(ws, &mut rx, &mut emit_fn, &params).await {
                    // Explicit disconnect / all senders dropped → terminal.
                    RunEnd::Cancelled => {
                        emit(status(&conn_id, ConnStatusKind::Disconnected, None, None));
                        return;
                    }
                    // Unexpected loss → reconnect unless cancelled or disabled.
                    RunEnd::Dropped(outcome) => {
                        let reason = outcome.reason.map(|r| scrub(r, &cfg));
                        if cancel.is_cancelled() || !cfg.reconnect.enabled {
                            emit(status(&conn_id, ConnStatusKind::Disconnected, reason, outcome.code));
                            return;
                        }
                        emit(status(&conn_id, ConnStatusKind::Reconnecting, reason, None));
                    }
                }
            }
            Err(e) => {
                let msg = scrub(e.to_string(), &cfg);
                emit(ChannelMsg::Error { message: msg.clone(), code: None });
                if cancel.is_cancelled() || !cfg.reconnect.enabled {
                    emit(status(&conn_id, ConnStatusKind::Disconnected, Some(msg), None));
                    return;
                }
                emit(status(&conn_id, ConnStatusKind::Reconnecting, Some(msg), None));
            }
        }

        // Interruptible backoff wait (F7): a disconnect mid-wait is instant and
        // does NOT attempt a further reconnect.
        tokio::select! {
            _ = sleep(backoff_delay(&mut backoff)) => {}
            _ = cancel.cancelled() => {
                emit(status(&conn_id, ConnStatusKind::Disconnected, None, None));
                return;
            }
        }
    }
}

/// Build a `ChannelMsg::Status` with an optional reason/code.
fn status(conn_id: &str, kind: ConnStatusKind, reason: Option<String>, code: Option<u16>) -> ChannelMsg {
    let mut s = ConnStatus::new(conn_id, kind);
    s.reason = reason;
    s.code = code;
    ChannelMsg::Status { status: s }
}

/// Capped exponential delay plus small jitter (0–199ms) to avoid synchronized
/// reconnect storms. The deterministic core is `ExponentialBackoff`; jitter is added
/// here so the state machine stays unit-testable.
fn backoff_delay(backoff: &mut ExponentialBackoff) -> Duration {
    let secs = backoff.next_delay_secs();
    Duration::from_secs(secs) + Duration::from_millis(jitter_ms())
}

fn jitter_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() % 200) as u64)
        .unwrap_or(0)
}

/// Scrub any secret header VALUE out of an outbound message so a token can never ride
/// an error/reason string back to the webview, even if some lower layer echoed it.
fn scrub(mut s: String, cfg: &ConnectConfig) -> String {
    for (name, value) in &cfg.headers {
        if is_sensitive_header(name) && !value.is_empty() {
            s = s.replace(value.as_str(), "***");
        }
    }
    s
}
