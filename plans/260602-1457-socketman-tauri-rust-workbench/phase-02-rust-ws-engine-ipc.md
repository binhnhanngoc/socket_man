---
phase: 2
title: "Rust WS Engine & IPC"
status: done
priority: P1
effort: "3-4d"
dependencies: [1]
completed: "2026-06-02"
---

> **Completed 2026-06-02 (cook).** Phase 1.5 backend skeleton (`error.rs`/`AppError`,
> `lib.rs` registry, `Cargo.toml` WS deps + committed `Cargo.lock`) + full Phase 2 WS
> engine. Single-task `select!` (`connection.rs`), hoisted `(tx,rx)` in `manager.rs`,
> stable connId, redacting `Debug` + emit-time secret scrub. Headers/Auth panes wired
> editable → `ConnectConfig.headers` (F14). `tauri-transport.ts` uses the `onmessage`
> setter; `index.ts` switches mock↔tauri by Tauri-runtime detection / `VITE_TRANSPORT`.
> Gates green: `cargo test` 5 unit + 5 integration (incl. **wss:// TLS** proof of the
> single-task loop + **connId-stable-across-reconnect / queued-send-survives** + secret
> redaction + conn-map-no-growth), `npm run build` (tsc strict + vite), 29 vitest (mock
> still selected under jsdom), CSP gate. Code-review DONE_WITH_CONCERNS: 0 Critical/High,
> all 8 locked contracts (F1/F3/F4/F6/F10/F13/F14/F25) verified; 2 Low (disconnect timing
> noted for P3; cosmetic clippy in test helpers). **Deferred:** manual GUI E2E (step 8)
> against a public `wss://` echo with a UI-typed Authorization header — needs a human at
> the running app; the header-on-upgrade path itself is test-verified over ws:// + wss://.

> **Red-team applied (2026-06-02):** depends on the **Phase 1.5 backend skeleton** (`error.rs`/`AppError`,
> `lib.rs` registry, `Cargo.toml` base) — build that first. Single-task `select!` topology with hoisted
> channel ownership + stable connId (F4), `Channel.onmessage` setter correction (F6), wire Headers/Auth
> panes to `ConnectConfig.headers` (F14), connId never copied on duplicate (F10), redacting `Debug` +
> error sanitization (F13), `ChannelMsg::Error` variant (F25).

# Phase 2: Rust WS Engine & IPC

## Overview

Build the real Rust WebSocket engine and the Tauri IPC bridge, then swap the frontend's mock
`Transport` for a `tauri-transport.ts` that calls `invoke()` and receives frames over an
`ipc::Channel`. End state: connect to a real `wss://` endpoint **with a custom `Authorization`
header on the upgrade request**, send messages, and watch live frames in the existing log UI.
Reliability (reconnect/heartbeat) is Phase 3; this phase is connect / send / receive / disconnect.

## Key Insights

- **Channel, not emit.** `ipc::Channel<ChannelMsg>` gives ordered, per-connection, high-throughput
  delivery. **`channel.onmessage` is a property SETTER** in TS (`channel.onmessage = cb`) — not awaitable.
  A single tagged enum on one channel carries `Frames`/`Status`/`Error`.
- **Custom upgrade headers** via `tungstenite::ClientRequestBuilder::with_header(...)` → `connect_async`.
  This is the single feature that justified the whole Rust-backend decision — test it explicitly.
- **Single-task `select!` topology (F4, decided once here).** Do NOT use the two-task `.split()` design —
  rustls streams can deadlock on independent split read+write (research §3 caveat), and Phase 3 needs a
  single `select!` loop anyway (read + write-rx + later heartbeat/coalesce). So Phase 2 ships the final
  shape now: one task running `select!` over `read.next()` and `rx.recv()`.
- **Hoist channel ownership (F4).** Create the write `(tx, rx)` in the manager/supervising layer, NOT
  inside the connection task — store `tx` in `ConnHandle`, pass `&mut rx` into the connection loop so the
  receiver (and `tx`, and the connId) **survive across a Phase 3 reconnect**. A task-local `(tx,rx)` would
  make Phase 3's "stable tx" impossible.
- Use `tauri::async_runtime::spawn` (not raw `tokio::spawn`) and `tokio::sync::Mutex` for state held
  across `.await`.
- **connId is a stable identity (F4/F10).** Generated Rust-side once at `ws_connect` (atomic u64 → string),
  returned to the frontend, and **reused as the `HashMap` key across every internal reconnect** (reconnect
  swaps the socket, never `next_id`). The frontend stores `connId` per active item; **a duplicated item
  starts with `connId=null`** and never inherits the source's connId (else two items alias one socket —
  `design/app.jsx:307` `ensureWsState`). A fresh `Channel` is created per `ws_connect`.

## Requirements

**Functional**
- `ws_connect(config, channel) -> conn_id`: opens a real WS connection with the given URL + headers;
  streams frames + status over the channel.
- `ws_send(conn_id, payload)`: sends a text frame.
- `ws_disconnect(conn_id)`: graceful close (WS close frame), task teardown, final `sys` close frame.
- Inbound text frames → `Frame{dir:"in", kind, body, ts, size}`; the UI's existing `frameSummary`
  renders them. `kind` defaults to `"message"` (server JSON has no kind); body is the parsed JSON or
  raw string.
- Status transitions emitted: connecting → connected (with `connectedAt`) → disconnected (reason/code).

**Functional (UI wiring — F14, the Authorization user-path):**
- The prototype's `HeadersPane`/`AuthPane` are **static `defaultValue` JSX with no state**
  (`design/app.jsx:89-126`). This phase MUST wire them to per-item connection state that feeds
  `ConnectConfig.headers` — otherwise the project's one hard requirement (user-supplied custom
  `Authorization` on the upgrade) is not user-drivable, only hardcodable. Add editable Headers KV rows +
  an Auth pane (type + token) that compose into `headers` at connect time.

**Non-functional**
- No blocking of the IPC thread; all socket work on spawned tasks.
- Errors return typed `AppError` that **never embeds raw header values or tokens** (F13): `ConnectConfig`
  and the header map implement a **redacting `Debug`** masking `authorization`/`cookie`/`proxy-authorization`;
  an error-sanitization layer ensures `AppError` strings and `ConnStatus.reason` carry no secret.
- Phase 2 changes **no component except** the Headers/Auth wiring above + swapping `transport/index.ts`
  to the real impl. (Phase 3 rebinds Settings/ConnectionBar; Phase 4 rebuilds HttpWorkspace — so the
  plan-wide "UI never changes" framing is dropped; only *Phase 2 itself* is near-inert on components.)

## Architecture

### Rust module layout (`src-tauri/src/`)
```
lib.rs              # builder: .manage(WsManager), generate_handler![ws_connect, ws_send, ws_disconnect]
commands.rs         # thin #[tauri::command] handlers → delegate to ws::manager
error.rs            # AppError (thiserror) + Serialize impl
ws/
  mod.rs
  types.rs          # ConnectConfig, Frame, ConnStatus, FrameBatch, ConnId, ChannelMsg enum
  manager.rs        # WsManager { conns: Mutex<HashMap<ConnId, ConnHandle>>, next_id: AtomicU64 }
  connection.rs     # spawn_connection: build request, connect_async, split, read+write loops
  request.rs        # build IntoClientRequest from ConnectConfig (URL + headers)
```

### IPC channel payload (single typed channel)
```rust
#[derive(Serialize, Clone)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ChannelMsg {
    Frames { batch: Vec<Frame> },   // Phase 2: per-frame arrays; Phase 3 coalesces (grows batch)
    Status { status: ConnStatus },
    Error  { message: String, code: Option<u16> },  // supersedes brainstorm ws://error (F25)
}
```
Frontend `tauri-transport.ts` (`onmessage` is a SETTER, not awaitable — F6):
```ts
const channel = new Channel<ChannelMsg>();
channel.onmessage = (m) => {
  if (m.t === "frames") onFrame(m.batch);
  else if (m.t === "status") onStatus(m.status);
  else onError(m.message, m.code);          // do NOT `await channel.onmessage(...)`
};
const connId = await invoke<string>("ws_connect", { config, channel });
```

### Connection task — SINGLE-TASK `select!` (F4; rx owned by caller, not the task)
```rust
// (tx, rx) created in the manager BEFORE connecting; tx stored in ConnHandle so it
// survives reconnect. The task borrows &mut rx.
let req = build_request(&cfg)?;                 // custom headers here
let (ws, _resp) = connect_async(req).await?;    // 101 upgrade
let (mut write, mut read) = ws.split();         // halves stay in ONE task — no cross-task split
loop {
    tokio::select! {
        msg = read.next() => match msg {
            Some(Ok(m))  => { /* emit ChannelMsg::Frames([frame]) */ }
            Some(Err(e)) => { /* emit Status disconnected / Error; break -> Phase 3 reconnects */ }
            None         => break,
        },
        cmd = rx.recv() => match cmd {
            Some(m) => { write.send(m).await?; }
            None    => { write.close().await.ok(); break; } // tx dropped -> graceful close
        },
        // Phase 3 adds: heartbeat tick, pong deadline, coalesce flush, cancel arm
    }
}
// connId stays stable in the HashMap; reconnect (Phase 3) swaps the socket, reuses tx/rx/connId.
```

### `build_request` (the critical bit)
```rust
let mut b = ClientRequestBuilder::new(cfg.url.parse::<Uri>()?);
for (k, v) in &cfg.headers { b = b.with_header(k.clone(), v.clone()); }
Ok(b) // IntoClientRequest
```
> TLS/self-signed handling is added Phase 3 via `connect_async_tls_with_config`; Phase 2 uses default
> `rustls-tls-native-roots` (valid certs only).

## Related Code Files

**Create:** `src-tauri/src/commands.rs`, `error.rs`, `ws/{mod,types,manager,connection,request}.rs`;
`src-tauri/tests/ws_integration.rs`; `src/transport/tauri-transport.ts`.

**Modify:** `src-tauri/src/lib.rs` (manage state + register commands), `src-tauri/Cargo.toml`
(add tokio-tungstenite 0.29 `rustls-tls-native-roots`, futures, http, serde, thiserror),
`src/transport/index.ts` (export tauri transport, keep mock for tests/storybook),
`src/transport/transport.ts` (only if contract needs a field added — keep names stable).

## Implementation Steps (TDD)

1. **Add crates** to `Cargo.toml`; `cargo build` to lock versions (tokio-tungstenite 0.29, futures 0.3,
   http 1, serde/serde_json, thiserror 1).
2. **TDD — `build_request` unit test (`ws/request.rs` `#[cfg(test)]`):** assert builder output carries
   `Authorization`, `Sec-WebSocket-Protocol`, `Origin`, `X-*` headers verbatim and correct URI. Implement.
3. **Define `types.rs`** (`ConnectConfig`, `Frame`, `ConnStatus`, `ChannelMsg`) mirroring `transport.ts`.
4. **TDD — integration test (`tests/ws_integration.rs`):** spin a local echo server in-test that
   **asserts the received `Authorization` header**, then have the manager connect, send, and assert:
   (a) server saw the auth header, (b) an `in` frame echoes back, (c) status connecting→connected,
   (d) disconnect closes cleanly, (e) **connId stays stable + `ws_send` works after a forced reconnect**
   (queue a send during the reconnect window → delivered, not dropped — proves the hoisted `(tx,rx)`),
   (f) a connect/disconnect loop does not grow the conn map. **Run at least one case over `wss://`**
   (local self-signed or a TLS echo) so the single-task `select!` is proven on TLS here, not discovered
   in manual E2E (F4). Implement `manager.rs` + `connection.rs` until green. Keystone test.
   - Add a **redaction test (F13):** trigger a connect error with a secret `Authorization` header; assert
     the token is absent from the `AppError` string, `ConnStatus.reason`, and any `Error` channel message.
4b. **Wire Headers/Auth panes (F14):** make `HeadersPane`/`AuthPane` editable, composing into
   per-item `ConnectConfig.headers`; the keystone E2E (step 8) uses a **UI-entered** token, not a
   hardcoded one.
5. **Implement commands** (`commands.rs`): thin async handlers taking `State<WsManager>` + `Channel`.
6. **Wire `lib.rs`:** `.manage(WsManager::default())`, `generate_handler![...]`, window-destroyed
   cleanup (drop senders → tasks exit) per research §6.
7. **Frontend `tauri-transport.ts`:** implement `Transport` via `invoke` + `Channel`. Switch
   `transport/index.ts` to it (env flag `VITE_TRANSPORT=mock|tauri` so Vitest keeps the mock).
8. **Manual E2E:** connect to a public echo (`wss://echo.websocket.events` or `wss://ws.postman-echo.com/raw`)
   **with a custom `Authorization` header**; verify live frames render, send round-trips, disconnect.
9. **Compile + test gate:** `cargo test` green, `npm test` green, `npm run tauri dev` E2E passes.

## Todo List

- [x] Phase 1.5 backend skeleton (error.rs/AppError, registry, Cargo base) exists
- [x] WS crates added + PINNED (Cargo.lock committed); `cargo build` clean
- [x] `build_request` unit test (custom headers) written first, green
- [x] `types.rs` mirrors `transport.ts` contract incl. `ChannelMsg::Error`
- [x] Integration test: Authorization header + echo + status + **connId-stable-across-reconnect** + **wss://** case, green
- [x] Redaction test: secret token absent from AppError/reason/Error message
- [x] Single-task `select!` connection loop (no two-task split); `(tx,rx)` hoisted to manager
- [x] Headers/Auth panes wired to `ConnectConfig.headers` (editable)
- [x] `ws_connect/ws_send/ws_disconnect` commands implemented + registered (alphabetized)
- [x] connId never copied on item duplicate (`null` on copies)
- [x] Window-close task cleanup wired (`shutdown_all` on `WindowEvent::Destroyed`)
- [x] `tauri-transport.ts` uses `channel.onmessage = cb` (setter); `index.ts` switches mock↔tauri by env flag/runtime
- [ ] Manual E2E: real echo endpoint with **UI-entered** custom Authorization header (needs human at running app; upgrade-header path test-verified over ws:// + wss://)

## Success Criteria

- [ ] Acceptance: connect to a real `wss://` with a custom `Authorization` header on the **upgrade**
      request; live frames appear in the log. (Verified by integration test + manual E2E.)
- [ ] Send → server echo renders as an `in` frame; out frame logged.
- [ ] Disconnect produces a clean close + `sys` close frame; no leaked tasks (verified by a connect/
      disconnect loop test not growing the conn map).
- [ ] connId stable across a forced reconnect; `ws_send` queued in the reconnect window is delivered.
- [ ] No secret token appears in any `AppError`, `ConnStatus.reason`, or `Error` channel message.
- [ ] Custom `Authorization` is entered through the wired Auth pane (not hardcoded) and reaches the upgrade.
- [ ] `cargo test` and `npm test` green; components unchanged except Headers/Auth wiring.

## Risk Assessment

- **TLS stream `.split()` deadlock** (research §3) → AVOIDED by design: single-task `select!` keeps both
  halves in one task (no cross-task split contention). This is why the topology is decided here, not deferred.
- **IPC flood** from a fast server → deferred to Phase 3 coalescing; Phase 2 caps the channel buffer
  and the UI already caps at MAX_FRAMES (400).
- **ConnId desync across reconnect/duplicate** → connId is a stable HashMap key, reused across reconnect,
  never copied on item duplicate (`connId=null` on copies). Covered by the stability test (step 4e).
- **Secret in error/log** → redacting `Debug` + sanitized `AppError` (step 4 redaction test).

## Security Considerations

- Non-secret header values travel UI→Rust over in-process IPC (acceptable). **Secret** env tokens are
  NOT resolved in JS (Phase 1 `skipSecret`); their `{{token}}` placeholders pass through literal and
  resolve Rust-side in Phase 5. A typed-in raw token (not an env var) is fine to pass for Phase 2 E2E.
- `ConnectConfig`/headers redact secrets in `Debug`; `AppError`/`reason`/`Error` never embed tokens (F13).
- Reject non-`ws/wss` URLs in `build_request`.

## Next Steps

Phase 3 adds reconnect/backoff + heartbeat on top of the connection task and `ConnStatus`.
