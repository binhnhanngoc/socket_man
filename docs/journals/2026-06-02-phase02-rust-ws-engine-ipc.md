# Phase 2 — Rust WS Engine & IPC

**Date:** 2026-06-02 · **Mode:** cook (--tdd) · **Status:** ✅ complete (1 manual GUI E2E deferred)

## What shipped

Turned the window-only Phase 1 shell into a real WebSocket transport. Built the
Phase 1.5 backend skeleton (`error.rs`/`AppError`, `lib.rs` command registry,
`Cargo.toml` WS deps + committed `Cargo.lock`) and the full Phase 2 engine:

- **`ws/connection.rs`** — single-task `tokio::select!` loop over the socket read half
  and the command receiver, generic over the stream so the *same* loop runs on plain
  `ws://` and TLS `wss://`. Both socket halves stay in one task (no cross-task
  `.split()`), sidestepping the rustls split-deadlock and matching the shape Phase 3
  extends (heartbeat/coalesce).
- **`ws/manager.rs`** — `WsManager` owns the conn map + an atomic connId. Channel
  ownership is **hoisted**: `(tx, rx)` are created before connecting, `tx` lives in the
  handle, `&mut rx` is lent to the loop — so a queued send survives a socket swap.
- **`ws/request.rs`** — `build_request` carries custom upgrade headers verbatim
  (the Authorization-on-upgrade requirement that justified the whole Rust backend).
- **Frontend** — `tauri-transport.ts` (real `Transport` via `invoke` + `ipc::Channel`,
  `onmessage` setter), `index.ts` selects tauri↔mock by runtime/`VITE_TRANSPORT`, and
  the Headers/Auth panes are now editable and compose into `ConnectConfig.headers`.

## Decisions / what was non-obvious

- **`ClientRequestBuilder`/`IntoClientRequest` live in `tungstenite::client`**, not
  `handshake::client` — the IPC research report's path was stale.
- **Generic `run_connection<S>` removed the need for a manager-level TLS connector.**
  The `wss://` test establishes its own self-signed TLS client stream (via `rcgen` +
  `tokio-rustls`) and hands the resulting `WebSocketStream` to the same loop. This
  proves `select!`-on-TLS without leaking Phase 3's insecure-cert toggle into Phase 2.
- **Reconnect-survival was proven without shipping reconnect.** Calling
  `run_connection` twice with the *same* `rx` (a send queued between the two sockets is
  delivered on the second) tests the hoisted-`(tx,rx)` architecture F4 cares about,
  leaving the auto-reconnect *policy* to Phase 3 where it belongs.
- **`mod tls;` from an integration-test root resolves to `tests/tls/mod.rs`** (a subdir,
  so Cargo won't compile it as a separate test binary) — not `tests/ws_integration/`.
- **Tauri v2 converts `invoke({connId})` → Rust `conn_id`** automatically; verified, so
  command args map correctly even though tests bypass the command layer.

## Security contracts held (red-team F1/F3/F4/F6/F10/F13/F14/F25)

Redacting `Debug` on `ConnectConfig` + an emit-time scrub of secret header values keep
tokens out of `AppError`/`reason`/`Error` (regression-tested). `secret_get` is not a
command. Duplicated UI items start `connId=null` (never alias a live socket).

## Gates

`cargo test` 5 unit + 5 integration · `npm run build` (tsc strict + vite) · 29 vitest
(mock still selected under jsdom) · CSP gate · code-review 0 Critical/High.

## Deferred

- Manual GUI E2E (connect to a public `wss://` echo with a UI-typed Authorization
  header) — needs a human at the running app; the upgrade-header path is already
  test-verified over both `ws://` and `wss://`.
- Low: `disconnect()` returns before the async close completes (fine for P2; revisit P3).
