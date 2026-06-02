# Phase 2 WS Engine & IPC — Code Review

Reviewer: code-reviewer | Date: 2026-06-02 | Verdict: **DONE_WITH_CONCERNS** (no Critical/High; 2 Low)

Scope: Rust WS engine (`src-tauri/src/{error,commands,lib}.rs`, `src/ws/*`), integration tests, TS transport + frontend wiring. All gates re-run green.

## Gate Results (verified, not assumed)
- `cargo test --offline`: 5 unit + 5 integration (incl. `single_task_select_runs_over_wss_with_custom_header`) — **pass**.
- `cargo clippy --offline --all-targets`: clean in `src/`; 3 cosmetic `result_large_err` warnings, all in **test** code on tungstenite's `ErrorResponse` type (not our types). Non-blocking.
- `npm test`: 29 vitest — **pass**.
- `npm run build` (tsc strict + vite): **pass**, 69 modules.

## Acceptance Criteria — all met
1. Custom `Authorization` on UPGRADE: `request.rs:19-22` `ClientRequestBuilder::with_header`; integration test asserts server saw it (`ws_integration.rs:135`, TLS case `:260`). User-path wired, not hardcoded (see F14). ✅
2. connect/send/disconnect + status flow + sys close frame: `connection.rs:79-122`, supervisor `manager.rs:102-133`. ✅
3. Stable connId across reconnect + queued send survives socket swap: hoisted `(tx,rx)` `manager.rs:46` lent as `&mut rx` `connection.rs:72`; proven `queued_send_survives_socket_swap_with_stable_conn_id`. connId stays null on duplicates (F10). ✅
4. No secret in AppError/reason/Error: `scrub()` `manager.rs:93-100` + redacting Debug `types.rs:30-39`; proven `secret_token_never_appears_in_emitted_messages`. ✅
5. Single-task `select!` (no `.split()` across tasks): `connection.rs:79-121`. ✅

## Locked Contracts — all hold (file:line)
- **F1** composeHeaders passes `{skipSecret:true}`: `use-workspace-store.ts:75,79`; resolver leaves secret literal `resolve-env.ts:37`. ✅
- **F3** `secret_get` absent from `generate_handler!` (`lib.rs:19-23`) and commands (only a comment ref `commands.rs:5`). ✅
- **F4** single-task select! + hoisted ownership + stable connId: verified above. ✅
- **F6** `channel.onmessage = cb` setter (`tauri-transport.ts:22`); no `await channel.onmessage(...)` anywhere. ✅
- **F10** duplicate starts connId=null: `ensureWsState` copies meta but not connIdMap (`use-workspace-store.ts:252-260`); keyed by item id so new id has no entry. ✅
- **F13** redacting Debug masks authorization/cookie/proxy-authorization (`types.rs:13,30-39`); AppError/reason scrubbed (`manager.rs:113,124,129`). ✅
- **F14** Headers/Auth panes editable, compose into `ConnectConfig.headers`: panes `ws-tab-panes.tsx:17-98` → `onMeta`/`updateMeta` (`ws-workspace.tsx:138-139`, `App.tsx:113-114`, `use-workspace-store.ts:322`) → `composeHeaders` at connect (`:168`). ✅
- **F25** `ChannelMsg::Error` present, tag `t` + camelCase (`types.rs:92-98`) matches TS union (`tauri-transport.ts:12-15`). ✅

## Rust↔TS Contract Drift — none found
- ConnStatus: `connId`/`connectedAt`/`rttMs`/`reason`/`code` all camelCase via `#[serde(rename_all="camelCase")]` (`types.rs:69`) ↔ TS `transport.ts:30-37`. Optional fields use `skip_serializing_if` ↔ TS `?`. ✅
- Frame `dir` lowercase enum (`types.rs:42`) ↔ TS `"in"|"out"|"sys"`. ✅
- ChannelMsg tags `frames`/`status`/`error` match. ✅
- **Tauri v2 arg mapping (the flagged High-risk item): CORRECT.** JS `invoke` sends `{connId, payload}` / `{connId}` (`tauri-transport.ts:40,44`); Rust params `conn_id`/`payload` (`commands.rs:30,35`). Tauri v2's command macro performs camelCase→snake_case conversion by default, so `connId`→`conn_id` resolves. `config`/`channel` are already matching. Not a bug — runtime invoke will succeed despite tests bypassing the command layer.

## run_connection correctness (`connection.rs:79-122`)
- Frame ordering correct: out frame emitted before `ws.send` (`:104-106`).
- Graceful close (rx None → all senders dropped): sends Close(1000) + sys frame, returns (`:111-119`). Matches `disconnect()` dropping the handle (`manager.rs:70`).
- Error path emits Error + returns outcome (`:95-98`).
- No busy-loop: both arms await (`ws.next()` / `rx.recv()`), select! parks otherwise.
- No panic on send-after-close: `ws.send(...).is_err()` handled (`:106`); `Message::Close` send uses `let _ =` (`:116`).

## Window-close cleanup (deadlock check)
`shutdown_all()` uses `blocking_lock()` (`manager.rs:80`) inside the `RunEvent::WindowEvent::Destroyed` closure (`lib.rs:26-30`). The `run()` event callback is a **synchronous** context (not an async task), so `blocking_lock` is correct here and will not deadlock the runtime. ✅

## Findings

### Low-1 — `disconnect()` does not await final close before returning (informational)
`manager.rs:69-72` removes the handle and returns immediately; the actual WS close frame is sent asynchronously by the loop's rx-None arm. UI optimistically sets `disconnected` (`use-workspace-store.ts:190`). Correct for Phase 2 (sys close frame still emitted via channel), but if a caller relied on close completing before `disconnect()` resolves it would be surprised. No action needed; note for Phase 3.

### Low-2 — clippy `result_large_err` in test helpers (cosmetic)
3 warnings in `ws_integration.rs:67,96` and `tls/mod.rs:46` from tungstenite's large `ErrorResponse`. Test-only, not our types. Optionally box the `Err` variant to silence; not worth churn.

## Positive Observations
- Redaction is defense-in-depth: redacting `Debug` AND value-scrubbing on emit — even if a lower layer echoed the token it gets masked (`manager.rs:93-100`).
- URL/scheme validated synchronously in `connect()` before spawn (`manager.rs:43`) so the webview gets an immediate rejection for bad URLs (rejects non-ws/wss `request.rs:15-18`).
- Self-cleanup removes the conn entry on task exit (`manager.rs:53-54`); proven non-leaking by `connect_disconnect_loop_does_not_grow_conn_map`.
- Frame-id sequence is process-global atomic (`connection.rs:23`) — unique ids across connections, good for React keys.
- Transport selector auto-detects `__TAURI_INTERNALS__` with `VITE_TRANSPORT` override (`index.ts:12-18`) so Vitest keeps the mock.

## Metrics
- Rust src clippy warnings: 0. Test warnings: 3 (cosmetic).
- TS: tsc strict pass, 29/29 vitest, build clean.

## Unresolved Questions
None. Report saved to task-specified path (`D:\Projects\socket_man\plans\reports\`), which differs from the hook's default (`src-tauri\plans\reports\`) — used the path in the delegation prompt.
