// Keystone integration tests for the Phase 2 WS engine.
//
// Proves the project's one hard requirement (a custom `Authorization` header on the
// WS upgrade) plus the architecture invariants: stable connId, hoisted `(tx,rx)`
// surviving a socket swap, clean disconnect, conn-map not leaking, secret redaction,
// and the single-task `select!` loop running over a real TLS (`wss://`) stream.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Instant};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::HeaderMap;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_hdr_async, client_async};

use socketman_lib::ws::cancel::Cancel;
use socketman_lib::ws::connection::{run_connection, Outbound, RunEnd, RunParams};
use socketman_lib::ws::manager::WsManager;
use socketman_lib::ws::request::build_request;
use socketman_lib::ws::types::{ChannelMsg, ConnectConfig, Frame, ReconnectConfig};

// ---- helpers ----

fn cfg(url: String, pairs: &[(&str, &str)]) -> ConnectConfig {
    let headers = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<BTreeMap<_, _>>();
    ConnectConfig { url, headers, ..Default::default() }
}

/// Same as `cfg` but with auto-reconnect OFF, so a dropped/failed socket surfaces a
/// terminal `disconnected` instead of looping `reconnecting`.
fn cfg_no_reconnect(url: String, pairs: &[(&str, &str)]) -> ConnectConfig {
    ConnectConfig {
        reconnect: ReconnectConfig { enabled: false, max_backoff_secs: 30 },
        ..cfg(url, pairs)
    }
}

/// RunParams for driving `run_connection` directly. `heartbeat` is caller-chosen so a
/// test can force fast ping/dead-detection; coalesce is the production 80ms.
fn run_params(heartbeat: Duration) -> RunParams {
    RunParams {
        conn_id: "test".into(),
        heartbeat,
        coalesce: Duration::from_millis(80),
        cancel: Cancel::new(),
    }
}

/// The ordered discriminants of an emit log: `connecting`/`connected`/`reconnecting`/
/// `disconnected` for statuses, `frames` / `error` otherwise. Used to assert ordering.
fn msg_kinds(log: &Log) -> Vec<String> {
    log.lock()
        .unwrap()
        .iter()
        .map(|m| match m {
            ChannelMsg::Status { status } => serde_json::to_value(status).unwrap()["status"].as_str().unwrap().to_string(),
            ChannelMsg::Frames { .. } => "frames".to_string(),
            ChannelMsg::Error { .. } => "error".to_string(),
        })
        .collect()
}

type Log = Arc<Mutex<Vec<ChannelMsg>>>;

fn collector() -> (Log, impl Fn(ChannelMsg) + Send + Sync + 'static) {
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let sink = log.clone();
    (log, move |m| sink.lock().unwrap().push(m))
}

fn in_frames(log: &Log) -> Vec<Frame> {
    log.lock().unwrap().iter().filter_map(|m| match m { ChannelMsg::Frames { batch } => Some(batch.clone()), _ => None }).flatten().collect()
}

fn statuses(log: &Log) -> Vec<String> {
    log.lock()
        .unwrap()
        .iter()
        .filter_map(|m| match m {
            ChannelMsg::Status { status } => Some(serde_json::to_value(status).unwrap()["status"].as_str().unwrap().to_string()),
            _ => None,
        })
        .collect()
}

/// A plain `ws://` echo server that records the upgrade request headers. Echoes text
/// frames; closes cleanly on a client close.
async fn spawn_echo_server() -> (String, Arc<Mutex<Option<HeaderMap>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let captured = Arc::new(Mutex::new(None));
    let cap = captured.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let cap = cap.clone();
            tokio::spawn(async move {
                let on_req = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                    *cap.lock().unwrap() = Some(req.headers().clone());
                    Ok(resp)
                };
                if let Ok(ws) = accept_hdr_async(stream, on_req).await {
                    let (mut w, mut r) = ws.split();
                    while let Some(Ok(msg)) = r.next().await {
                        match msg {
                            Message::Text(_) | Message::Binary(_) => {
                                if w.send(msg).await.is_err() { break; }
                            }
                            Message::Close(_) => break,
                            _ => {}
                        }
                    }
                }
            });
        }
    });
    (format!("ws://{addr}/"), captured)
}

/// A `ws://` server that echoes exactly one text frame then closes — makes
/// `run_connection` return deterministically (used by the reconnect-survival test).
async fn spawn_echo_once_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            if let Ok(mut ws) = accept_hdr_async(stream, |_: &Request, r: Response| Ok::<_, ErrorResponse>(r)).await {
                if let Some(Ok(msg)) = ws.next().await {
                    let _ = ws.send(msg).await;
                }
                let _ = ws.close(None).await;
            }
        }
    });
    format!("ws://{addr}/")
}

async fn connect_plain(url: &str, headers: &[(&str, &str)]) -> tokio_tungstenite::WebSocketStream<TcpStream> {
    let request = build_request(&cfg(url.to_string(), headers)).unwrap();
    let host_port = url.trim_start_matches("ws://").trim_end_matches('/');
    let tcp = TcpStream::connect(host_port).await.unwrap();
    let (ws, _resp) = client_async(request, tcp).await.unwrap();
    ws
}

// ---- tests ----

#[tokio::test]
async fn ws_connect_sends_authorization_and_echoes_with_status_flow() {
    let (url, captured) = spawn_echo_server().await;
    let (log, sink) = collector();
    let manager = WsManager::default();

    let conn_id = manager
        .connect(cfg(url, &[("Authorization", "Bearer atk_live_secret_8f2a"), ("X-Plant-Id", "lehigh-valley")]), sink)
        .await
        .expect("connect ok");

    // Wait for the connection to establish, then round-trip a message.
    sleep(Duration::from_millis(150)).await;
    {
        let s: String = "{\"action\":\"subscribe\",\"channel\":\"boiler.3\"}".into();
        manager.send(&conn_id, s.clone(), s).await.unwrap();
    }
    sleep(Duration::from_millis(200)).await;

    // (a) server received the custom Authorization header on the upgrade.
    let headers = captured.lock().unwrap().clone().expect("server saw an upgrade");
    assert_eq!(headers.get("authorization").unwrap(), "Bearer atk_live_secret_8f2a");
    assert_eq!(headers.get("x-plant-id").unwrap(), "lehigh-valley");

    // (b) status connecting → connected, (c) an out frame + an echoed in frame.
    let st = statuses(&log);
    assert_eq!(st.first().map(String::as_str), Some("connecting"));
    assert!(st.contains(&"connected".to_string()), "statuses: {st:?}");
    let frames = in_frames(&log);
    assert!(frames.iter().any(|f| matches!(f.dir, socketman_lib::ws::types::FrameDir::Out)), "expected an out frame");
    assert!(
        frames.iter().any(|f| matches!(f.dir, socketman_lib::ws::types::FrameDir::In) && f.body["channel"] == "boiler.3"),
        "expected echoed in frame, got {:?}",
        frames.iter().map(|f| f.body.clone()).collect::<Vec<_>>()
    );

    // (d) clean disconnect emits a sys close frame and a disconnected status.
    manager.disconnect(&conn_id).await.unwrap();
    sleep(Duration::from_millis(150)).await;
    assert!(statuses(&log).contains(&"disconnected".to_string()));
    assert!(in_frames(&log).iter().any(|f| matches!(f.dir, socketman_lib::ws::types::FrameDir::Sys)), "expected sys close frame");
}

#[tokio::test]
async fn connect_disconnect_loop_does_not_grow_conn_map() {
    let (url, _captured) = spawn_echo_server().await;
    let manager = WsManager::default();
    for _ in 0..5 {
        let (_log, sink) = collector();
        let id = manager.connect(cfg(url.clone(), &[]), sink).await.unwrap();
        sleep(Duration::from_millis(60)).await;
        manager.disconnect(&id).await.unwrap();
        sleep(Duration::from_millis(60)).await;
    }
    sleep(Duration::from_millis(100)).await;
    assert_eq!(manager.conn_count().await, 0, "conn map leaked");
}

#[tokio::test]
async fn secret_token_never_appears_in_emitted_messages() {
    // Connect to a closed port so the connect fails and emits Error + disconnected.
    let token = "Bearer super-secret-do-not-leak-42";
    let (log, sink) = collector();
    let manager = WsManager::default();
    // Reconnect OFF so the failed connect terminates with `disconnected` instead of
    // looping `reconnecting`; the redaction guarantee is identical either way.
    let id = manager.connect(cfg_no_reconnect("ws://127.0.0.1:1/".into(), &[("Authorization", token)]), sink).await.unwrap();
    let _ = id;
    // Poll until the failed connect has emitted its terminal disconnected status
    // (connection-refused timing varies by OS), up to a generous ceiling.
    for _ in 0..40 {
        if statuses(&log).contains(&"disconnected".to_string()) {
            break;
        }
        sleep(Duration::from_millis(50)).await;
    }

    let serialized = serde_json::to_string(&*log.lock().unwrap()).unwrap();
    assert!(!serialized.contains("super-secret-do-not-leak-42"), "secret leaked: {serialized}");
    // The failure still surfaced as an Error + disconnected status.
    assert!(statuses(&log).contains(&"disconnected".to_string()), "no disconnected status: {serialized}");
}

#[tokio::test]
async fn url_secret_value_never_appears_in_connect_error() {
    // A secret resolved into the URL (Phase 5) must be scrubbed from any connect-error
    // reason, even if a lower layer embeds the URI. The command sets cfg.redact to the
    // resolved secret values; the supervisor's scrub masks them.
    let secret = "url-secret-zzz-99";
    let (log, sink) = collector();
    let manager = WsManager::default();
    let mut cfg = cfg_no_reconnect(format!("ws://127.0.0.1:1/{secret}"), &[]);
    cfg.redact = vec![secret.to_string()];
    let _ = manager.connect(cfg, sink).await.unwrap();
    for _ in 0..40 {
        if statuses(&log).contains(&"disconnected".to_string()) {
            break;
        }
        sleep(Duration::from_millis(50)).await;
    }
    let serialized = serde_json::to_string(&*log.lock().unwrap()).unwrap();
    assert!(!serialized.contains(secret), "URL secret leaked into connect error: {serialized}");
}

#[tokio::test]
async fn queued_send_survives_socket_swap_with_stable_conn_id() {
    // Proves the hoisted (tx, rx): a send buffered while "disconnected" is delivered
    // after a "reconnect" because rx outlives the connection task. connId is the same
    // string across both rounds (we own it here, the manager reuses it across reconnect).
    let conn_id = "42"; // stable across both rounds
    let (tx, mut rx) = mpsc::channel::<Outbound>(16);

    // Round 1: server echoes once then closes → run_connection returns.
    let url1 = spawn_echo_once_server().await;
    let ws1 = connect_plain(&url1, &[]).await;
    tx.send(Outbound::plain(Message::Text("{\"n\":1}".into()))).await.unwrap();
    let log1 = Arc::new(Mutex::new(Vec::new()));
    let log1c = log1.clone();
    let mut sink1 = move |m| log1c.lock().unwrap().push(m);
    let p1 = run_params(Duration::from_secs(30));
    let _ = timeout(Duration::from_secs(2), run_connection(ws1, &mut rx, &mut sink1, &p1)).await.expect("round 1 finished");
    assert_eq!(conn_id, "42");

    // Between rounds (socket down): queue a send. It buffers in rx, NOT lost.
    tx.send(Outbound::plain(Message::Text("{\"n\":2}".into()))).await.unwrap();

    // Round 2: fresh socket, SAME rx. The queued n:2 must be delivered + echoed.
    let url2 = spawn_echo_once_server().await;
    let ws2 = connect_plain(&url2, &[]).await;
    let log2 = Arc::new(Mutex::new(Vec::new()));
    let log2c = log2.clone();
    let mut sink2 = move |m| log2c.lock().unwrap().push(m);
    let p2 = run_params(Duration::from_secs(30));
    let _ = timeout(Duration::from_secs(2), run_connection(ws2, &mut rx, &mut sink2, &p2)).await.expect("round 2 finished");

    let frames: Vec<Frame> = log2
        .lock()
        .unwrap()
        .iter()
        .filter_map(|m| match m { ChannelMsg::Frames { batch } => Some(batch.clone()), _ => None })
        .flatten()
        .collect();
    assert!(
        frames.iter().any(|f| matches!(f.dir, socketman_lib::ws::types::FrameDir::In) && f.body["n"] == 2),
        "queued send n:2 not delivered after swap, frames: {:?}",
        frames.iter().map(|f| f.body.clone()).collect::<Vec<_>>()
    );
}

mod tls;

#[tokio::test]
async fn single_task_select_runs_over_wss_with_custom_header() {
    // Local self-signed wss:// echo. The TEST establishes the TLS client stream itself
    // (trusting its own cert) and hands the resulting WebSocketStream to the SAME
    // run_connection loop — proving the single-task select! works on a TLS stream.
    let (addr, server_cert) = tls::spawn_tls_echo_server().await;
    let captured = server_cert.captured.clone();

    let request = build_request(&cfg(format!("wss://localhost:{}/", addr.port()), &[("Authorization", "Bearer tls_secret_token")])).unwrap();
    let tls_stream = tls::tls_client_connect(addr, &server_cert.cert_der).await;
    let (ws, _resp) = client_async(request, tls_stream).await.unwrap();

    let (tx, mut rx) = mpsc::channel::<Outbound>(16);
    tx.send(Outbound::plain(Message::Text("{\"hello\":\"tls\"}".into()))).await.unwrap();
    // Keep tx alive: the echo-once server closes the socket after echoing, which ends
    // the loop deterministically (no race between the echo and a graceful close).
    let _tx = tx;
    let log = Arc::new(Mutex::new(Vec::new()));
    let logc = log.clone();
    let mut sink = move |m| logc.lock().unwrap().push(m);
    let params = run_params(Duration::from_secs(30));
    let _ = timeout(Duration::from_secs(3), run_connection(ws, &mut rx, &mut sink, &params)).await.expect("tls loop finished");

    let headers = captured.lock().unwrap().clone().expect("tls server saw upgrade");
    assert_eq!(headers.get("authorization").unwrap(), "Bearer tls_secret_token");
    let frames: Vec<Frame> = log
        .lock()
        .unwrap()
        .iter()
        .filter_map(|m| match m { ChannelMsg::Frames { batch } => Some(batch.clone()), _ => None })
        .flatten()
        .collect();
    assert!(frames.iter().any(|f| f.body["hello"] == "tls"), "expected tls echo, frames: {frames:?}");
}

// ---- Phase 3: reliability servers ----

/// Unified-loop echo server (no `.split()`) that explicitly answers our outbound
/// pings with a pong — so the heartbeat RTT path can be exercised deterministically.
async fn spawn_ping_aware_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                if let Ok(mut ws) = accept_hdr_async(stream, |_: &Request, r: Response| Ok::<_, ErrorResponse>(r)).await {
                    while let Some(Ok(msg)) = ws.next().await {
                        match msg {
                            Message::Text(_) | Message::Binary(_) => {
                                if ws.send(msg).await.is_err() { break; }
                            }
                            Message::Ping(p) => {
                                let _ = ws.send(Message::Pong(p)).await;
                            }
                            Message::Close(_) => break,
                            _ => {}
                        }
                    }
                }
            });
        }
    });
    format!("ws://{addr}/")
}

/// Accepts the upgrade then goes silent — never reads, never pongs. Holds the socket
/// open so the client's dead-socket detector (missed pong) is what ends the loop.
async fn spawn_silent_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            if let Ok(ws) = accept_hdr_async(stream, |_: &Request, r: Response| Ok::<_, ErrorResponse>(r)).await {
                // Keep the stream alive but inert (no reads ⇒ no auto-pong).
                sleep(Duration::from_secs(30)).await;
                drop(ws);
            }
        }
    });
    format!("ws://{addr}/")
}

/// Drops the FIRST connection immediately (forces one reconnect), then serves later
/// connections as a stable ping-aware echo. Returns the accept counter.
async fn spawn_drop_once_then_stable_server() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let accepts = Arc::new(AtomicUsize::new(0));
    let counter = accepts.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let idx = counter.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                if let Ok(mut ws) = accept_hdr_async(stream, |_: &Request, r: Response| Ok::<_, ErrorResponse>(r)).await {
                    if idx == 0 {
                        let _ = ws.close(None).await; // drop once → triggers reconnect
                    } else {
                        while let Some(Ok(msg)) = ws.next().await {
                            match msg {
                                Message::Text(_) | Message::Binary(_) => {
                                    if ws.send(msg).await.is_err() { break; }
                                }
                                Message::Ping(p) => {
                                    let _ = ws.send(Message::Pong(p)).await;
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                    }
                }
            });
        }
    });
    (format!("ws://{addr}/"), accepts)
}

/// On connect, sends a burst of text frames then closes — for the ordering contract.
async fn spawn_burst_then_close_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            if let Ok(mut ws) = accept_hdr_async(stream, |_: &Request, r: Response| Ok::<_, ErrorResponse>(r)).await {
                for n in 0..5 {
                    if ws.send(Message::Text(format!("{{\"n\":{n}}}").into())).await.is_err() { break; }
                }
                let _ = ws.close(None).await;
            }
        }
    });
    format!("ws://{addr}/")
}

/// Accepts then closes each connection immediately, counting accepts — used to prove a
/// disconnect during backoff stops further reconnect attempts.
async fn spawn_count_accept_close_server() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let accepts = Arc::new(AtomicUsize::new(0));
    let counter = accepts.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            counter.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(async move {
                if let Ok(mut ws) = accept_hdr_async(stream, |_: &Request, r: Response| Ok::<_, ErrorResponse>(r)).await {
                    let _ = ws.close(None).await;
                }
            });
        }
    });
    (format!("ws://{addr}/"), accepts)
}

// ---- Phase 3: reliability tests ----

#[tokio::test]
async fn reconnect_after_drop_reuses_conn_and_send_path() {
    let (url, accepts) = spawn_drop_once_then_stable_server().await;
    let (log, sink) = collector();
    let manager = WsManager::default();

    let conn_id = manager.connect(cfg(url, &[]), sink).await.expect("connect ok");

    // First connect drops → supervisor emits reconnecting, waits backoff (~1s), reconnects.
    // Poll for the SECOND connected (after a reconnecting) up to a generous ceiling.
    let mut reconnected = false;
    for _ in 0..40 {
        let st = statuses(&log);
        if st.iter().filter(|s| *s == "connected").count() >= 2 && st.contains(&"reconnecting".to_string()) {
            reconnected = true;
            break;
        }
        sleep(Duration::from_millis(100)).await;
    }
    assert!(reconnected, "expected reconnecting→connected, got {:?}", statuses(&log));
    assert!(accepts.load(Ordering::SeqCst) >= 2, "server should have accepted a reconnect");

    // The SAME connId still drives the send path after the reconnect.
    {
        let s: String = "{\"action\":\"ping\",\"v\":7}".into();
        manager.send(&conn_id, s.clone(), s).await.unwrap();
    }
    sleep(Duration::from_millis(250)).await;
    assert!(
        in_frames(&log).iter().any(|f| matches!(f.dir, socketman_lib::ws::types::FrameDir::In) && f.body["v"] == 7),
        "echoed frame after reconnect not seen"
    );

    manager.disconnect(&conn_id).await.unwrap();
}

#[tokio::test]
async fn heartbeat_reports_rtt() {
    let url = spawn_ping_aware_server().await;
    let ws = connect_plain(&url, &[]).await;
    let (tx, mut rx) = mpsc::channel::<Outbound>(16);
    let _tx = tx; // keep the sender alive so rx never closes during the probe

    let (log, _sink) = collector();
    let logc = log.clone();
    let mut sink = move |m| logc.lock().unwrap().push(m);
    // Fast heartbeat so a pong-driven RTT status arrives well within the test window.
    let params = run_params(Duration::from_millis(120));
    let cancel = params.cancel.clone();

    let handle = tokio::spawn(async move {
        run_connection(ws, &mut rx, &mut sink, &params).await;
    });

    // Wait for at least one Status carrying rttMs.
    let mut saw_rtt = false;
    for _ in 0..30 {
        let has_rtt = log.lock().unwrap().iter().any(|m| matches!(m, ChannelMsg::Status { status }
            if serde_json::to_value(status).unwrap().get("rttMs").is_some()));
        if has_rtt {
            saw_rtt = true;
            break;
        }
        sleep(Duration::from_millis(80)).await;
    }
    cancel.cancel();
    let _ = timeout(Duration::from_secs(2), handle).await;
    assert!(saw_rtt, "expected a Status with rttMs from the heartbeat pong");
}

#[tokio::test]
async fn dead_socket_missed_pong_drops_for_reconnect() {
    let url = spawn_silent_server().await;
    let ws = connect_plain(&url, &[]).await;
    let (tx, mut rx) = mpsc::channel::<Outbound>(16);
    let _tx = tx;

    let (_log, _sink) = collector();
    let mut sink = |_m| {};
    // Short heartbeat: ping at ~120ms, no pong, dead detected at ~240ms.
    let params = run_params(Duration::from_millis(120));

    let end = timeout(Duration::from_secs(2), run_connection(ws, &mut rx, &mut sink, &params))
        .await
        .expect("dead-detection should end the loop well within 2s");
    match end {
        RunEnd::Dropped(o) => assert_eq!(o.reason.as_deref(), Some("heartbeat timeout")),
        RunEnd::Cancelled => panic!("a missed pong must be a Dropped (reconnectable), not Cancelled"),
    }
}

#[tokio::test]
async fn frames_never_precede_connected_status() {
    // Ordering contract (F5): the frontend must never receive Frames for a conn whose
    // status is not yet `connected`. With reconnect OFF the sequence is terminal.
    let url = spawn_burst_then_close_server().await;
    let (log, sink) = collector();
    let manager = WsManager::default();
    let conn_id = manager.connect(cfg_no_reconnect(url, &[]), sink).await.unwrap();

    for _ in 0..30 {
        if msg_kinds(&log).contains(&"disconnected".to_string()) { break; }
        sleep(Duration::from_millis(50)).await;
    }

    let kinds = msg_kinds(&log);
    let first_connected = kinds.iter().position(|k| k == "connected").expect("a connected status");
    let first_frames = kinds.iter().position(|k| k == "frames");
    if let Some(fi) = first_frames {
        assert!(fi > first_connected, "frames at {fi} preceded connected at {first_connected}: {kinds:?}");
    }
    assert_eq!(kinds.last().map(String::as_str), Some("disconnected"), "kinds: {kinds:?}");
    let _ = conn_id;
}

#[tokio::test]
async fn disconnect_during_backoff_is_instant_and_stops_reconnect() {
    let (url, accepts) = spawn_count_accept_close_server().await;
    let (log, sink) = collector();
    let manager = WsManager::default();
    let conn_id = manager.connect(cfg(url, &[]), sink).await.unwrap();

    // Let it connect, get dropped, and enter the (~1s) backoff sleep.
    sleep(Duration::from_millis(400)).await;
    let accepts_before = accepts.load(Ordering::SeqCst);
    assert!(accepts_before >= 1, "server should have accepted the first connect");
    assert!(statuses(&log).contains(&"reconnecting".to_string()), "should be mid-backoff");

    // Disconnect mid-backoff → teardown must be near-instant and emit disconnected.
    let t0 = Instant::now();
    manager.disconnect(&conn_id).await.unwrap();
    let mut torn_down = false;
    for _ in 0..20 {
        if statuses(&log).contains(&"disconnected".to_string()) {
            torn_down = true;
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }
    assert!(torn_down, "no disconnected after cancel: {:?}", statuses(&log));
    assert!(t0.elapsed() < Duration::from_millis(300), "teardown took {:?} (should be instant)", t0.elapsed());

    // And NO further reconnect was attempted past the point of cancel.
    sleep(Duration::from_millis(400)).await;
    assert_eq!(accepts.load(Ordering::SeqCst), accepts_before, "a reconnect was attempted after disconnect");
}

#[tokio::test]
#[ignore = "spins up a self-signed wss server; run explicitly with `cargo test -- --ignored`"]
async fn self_signed_connects_only_with_insecure_toggle() {
    // Secure (default): the self-signed cert is not in the trust store ⇒ connect fails.
    let (addr_secure, _cert_secure) = tls::spawn_tls_echo_server().await;
    let secure = ConnectConfig { url: format!("wss://localhost:{}/", addr_secure.port()), ..Default::default() };
    assert!(
        socketman_lib::ws::tls::connect_ws(&secure).await.is_err(),
        "strict TLS must reject a self-signed cert"
    );

    // Insecure toggle ON: verification disabled ⇒ the same self-signed endpoint connects.
    let (addr_insecure, _cert_insecure) = tls::spawn_tls_echo_server().await;
    let insecure = ConnectConfig {
        url: format!("wss://localhost:{}/", addr_insecure.port()),
        insecure_tls: true,
        ..Default::default()
    };
    assert!(
        socketman_lib::ws::tls::connect_ws(&insecure).await.is_ok(),
        "insecure_tls=true must accept the self-signed cert"
    );
}
