# Phase 3 "WS Reliability" — Code Review

Reviewer: code-reviewer | Date: 2026-06-02 | Status: **DONE_WITH_CONCERNS**
Scope: src-tauri/src/ws/{backoff,heartbeat,cancel,tls,connection,reconnect,manager,types}.rs,
commands.rs, lib.rs, tests/ws_integration.rs; frontend transport.ts, types.ts,
use-workspace-store.ts, ws-tab-panes.tsx, connection-bar.tsx, ws-workspace.tsx, app.css.
Tests not re-run (stated green); review is of CODE.

Overall: solid, faithful to the plan. No Critical findings. Two Medium correctness/robustness
items and a handful of Low. All 7 acceptance criteria met.

---

## Critical
None.

## High
None.

## Medium

### M1 — connect_ws() handshake is NOT cancellable; disconnect during a slow connect can hang up to OS TCP timeout
`reconnect.rs:59` `match connect_ws(&cfg).await` has NO cancel arm. The backoff sleep IS
interruptible (`reconnect.rs:99-105`) and the inner `run_connection` IS (`connection.rs:199`),
but the in-flight TLS/TCP handshake is not. If `ws_disconnect` fires while the supervisor is
blocked in `connect_async`/TLS to an unreachable host, teardown waits until the connect
resolves/fails (could be the OS connect timeout, tens of seconds), then exits cleanly.
- Acceptance #7 ("tears down <100-300ms") is verified only for the *backoff-sleep* window
  (the integration test `disconnect_during_backoff_is_instant_and_stops_reconnect` cancels
  during the sleep, not during a hanging connect). The connect-hang window is untested and
  unbounded.
- Impact: not a leak (task still exits, map already cleaned by `disconnect`), but the UI shows
  "Reconnecting…/Connecting…" longer than promised and emits `disconnected` late.
- Fix: wrap connect in `select!` against `cancel.cancelled()` (return without reconnect on
  cancel), mirroring the sleep arm. Optionally add a connect timeout. Low effort.

### M2 — `connectedAt` preservation makes a true reconnect keep the OLD elapsed timer
`use-workspace-store.ts:196-201`: on any `connected` status, `connectedAt = c.connectedAt ?? s.connectedAt ?? Date.now()`.
This correctly stops RTT updates resetting the timer. BUT after a real drop→reconnect, the Rust
side emits `reconnecting` (status stays non-disconnected, `connectedAt` NOT cleared — line 201
keeps `c.connectedAt` for the reconnecting branch) then a fresh `connected` carrying a NEW
`connectedAt`. Because `c.connectedAt` is still set, the `??` keeps the STALE value and the new
`connectedAt` from the supervisor (`status_connected`, connection.rs:225-228) is ignored. The
"Connected" uptime timer therefore counts across the outage instead of restarting at reconnect.
- Not data loss; cosmetic but user-visible and arguably wrong (timer should reflect the current
  socket's age, and the supervisor went to the trouble of stamping a fresh `connected_at`).
- If the intended product behavior is "uptime since first connect, spanning reconnects", this is
  correct and only the comment is misleading. Needs a product decision — flagged as unresolved Q1.
- Fix (if restart-on-reconnect desired): when the *previous* status was `reconnecting`/`connecting`,
  prefer `s.connectedAt` over `c.connectedAt`.

## Low

### L1 — `disconnect()` optimistically sets `disconnected`, masking the terminal status race
`use-workspace-store.ts:213-217` sets status `disconnected` immediately on user disconnect. The
Rust supervisor will ALSO emit a terminal `disconnected`. Harmless (same end state) and gives
snappy UI, but means the UI's `disconnected` is not the authoritative one. Fine as-is; note only.

### L2 — connect failure emits BOTH `ChannelMsg::Error` and a status, drop path emits only status
`reconnect.rs:86-94` (Err branch) emits `Error` + `Reconnecting`/`Disconnected`; the `Dropped`
branch (`:76-83`) emits only a status with `reason`. Asymmetric contract: a transport-level
connect failure produces an extra `Error` message, a mid-stream drop does not. Frontend ignores
`Error` (no `onError` in the Transport interface — transport.ts:62-72), so the `Error` messages
are currently dead weight over IPC. Not a bug; consider dropping the `Error` emit or wiring it.

### L3 — jitter source is wall-clock subsec_nanos, not a PRNG
`reconnect.rs:125-130` derives 0-199ms jitter from `SystemTime::now().subsec_nanos()`. Adequate
for a single-connection desktop app (the plan calls thundering-herd "minor"), but multiple
simultaneous reconnects scheduled in the same tick could correlate. Acceptable per YAGNI; noted.

### L4 — heartbeat "Dead" reason string is generic
`connection.rs:172` returns reason `"heartbeat timeout"`. After scrub it surfaces as the
`reconnecting`/`disconnected` reason. Fine; just confirm the UI doesn't render it as a scary error
(it currently doesn't display `reason` in the status chip — connection-bar.tsx). OK.

### L5 — `shutdown_all` uses `blocking_lock()` on the Tauri main thread
`manager.rs:90`. Called from `RunEvent::WindowEvent::Destroyed` (lib.rs:27-29). If the async
runtime holds the conns mutex at that instant, `blocking_lock` blocks the event loop briefly.
Contention window is tiny (lock is only held for map ops). Acceptable for shutdown; noted.

---

## Acceptance Criteria — verdict

1. **Auto-reconnect + capped backoff + `reconnecting` (kind only) + reset-on-success — MET.**
   backoff.rs sequence `1,2,4,8,16,30,30` + overflow-safe (`checked_shl`); `reset()` on success
   (reconnect.rs:61). No attempt-count anywhere in contract/UI (ConnStatus has no attempt field;
   verified types.rs + transport.ts). Reconnecting status emitted at reconnect.rs:82/93.

2. **Heartbeat 30s + RTT + dead-socket reconnect — MET.** `default_heartbeat_secs=30`; explicit
   `awaiting_pong` state machine (heartbeat.rs) — missed pong by next tick ⇒ `Dead` ⇒
   `RunEnd::Dropped("heartbeat timeout")` ⇒ supervisor reconnects (not a silent hang). RTT decoded
   from echoed BE timestamp, `saturating_sub` guards clock skew, wrong-length payload → None (no
   bogus RTT). One outbound ping per interval ⇒ unambiguous pong match. Integration tests cover
   RTT and dead-detection.

3. **Frame coalescing ~80ms bounded 256 — MET.** `FRAME_BATCH_CAP=256` (connection.rs:36),
   `COALESCE=80ms` (reconnect.rs:29), flush on cap or coalesce tick (connection.rs:136-138,197).
   `interval_at(now+period,…)` avoids a t=0 empty flush. Both inbound and outbound text frames go
   through the batch.

4. **insecure_tls disables ALL verification; OFF by default; re-warned every connect; red badge — MET.**
   `NoVerification` verifier accepts any cert + any hostname + both TLS1.2/1.3 sig schemes
   (tls.rs:48-81) — genuine full-MITM, not accept-self-signed-only. Default false (types.rs:61-62,
   Default impl, unit test `secure_by_default…`). `connect()` in use-workspace-store.ts:169-177
   issues `window.confirm` on EVERY connect when `insecureTls`, abort on cancel. Red "TLS OFF"
   badge connection-bar.tsx:36-40; "MITM RISK" badge + danger note in SettingsPane. CSS present.
   NOTE: no Rust-side "verification disabled" log line (plan §Architecture (c) asked for a
   no-secret connect log) — see L-note Q2; not a security hole, the UI warning is the load-bearing
   control.

5. **Settings mostly display-only; only auto-reconnect + insecure-TLS live — MET.** SettingsPane
   (ws-tab-panes.tsx:104-160): two `<button className="toggle">` controls (reconnect, insecureTls);
   heartbeat/backoff/coalesce/buffer are static `set-val` labels. No editable inputs/validation/
   persistence for the hardcoded knobs. ConnMeta only carries `reconnect`/`insecureTls` (types.ts).

6. **Ordering: no Frames before `connected` (flush-before-status) — MET.** `flush_batch` called
   before every status emit (connection.rs:143-145 on pong/RTT; close/err/dead paths flush before
   returning). Supervisor emits `connected` (reconnect.rs:62) BEFORE entering `run_connection`, so
   no frame can be produced pre-`connected`. Integration test `frames_never_precede_connected_status`
   asserts it.

7. **Cancellation: disconnect during backoff <100-300ms, no further reconnect; disconnect never
   reconnects — MET (with M1 caveat).** Cancel arm in inner loop (connection.rs:199 → Cancelled,
   terminal) AND in backoff sleep (reconnect.rs:99-105). Supervisor rechecks `is_cancelled()` after
   every `Dropped`/connect-failure before looping (reconnect.rs:78,89), so a cancel that races a
   drop cannot trigger a reconnect. Manager cancels then removes (manager.rs:75-81); self-cleanup
   is idempotent. Integration test asserts <300ms + zero further accepts. **Caveat M1:** the
   *handshake* window is not cancellable.

---

## Regression / contract checks (b) — PASS

- **ConnectConfig serde:** minimal `{"url":"…"}` still deserializes; serde defaults fill
  heartbeat=30, reconnect{enabled:true,maxBackoff:30}, insecure_tls=false (unit test
  `connect_config_defaults_when_reliability_fields_absent`). camelCase mirror intact
  (`heartbeatSecs`/`reconnect`/`insecureTls`). TS `ConnectConfig` keeps `{url,headers}` required,
  new fields optional (transport.ts:10-22) — non-breaking. Frontend sends only
  `reconnect:{enabled}` + `insecureTls` (use-workspace-store.ts:182-187); omitted `heartbeatSecs`
  and `maxBackoffSecs` fall to Rust defaults. Good.
- **ChannelMsg / ConnStatus camelCase:** `#[serde(tag="t", rename_all="camelCase")]`,
  `connId`/`connectedAt`/`rttMs` confirmed by unit test. New `rtt_ms` is
  `skip_serializing_if=Option::is_none` so it never appears on non-RTT statuses — no contract
  bloat.
- **run_connection signature change ripple:** now `(ws, &mut rx, &mut emit, &RunParams) -> RunEnd`.
  All callers updated (reconnect.rs supervisor + 3 integration tests). `RunEnd` Cancelled/Dropped
  split is clean. No stale callers found.
- **FrameDir / Frame / sys-frame shape:** unchanged; sys close frame still emitted on graceful
  close and server close.

## Security (c) — PASS

- `secret_get` NOT registered (lib.rs:19-23 handler list = ws_connect/ws_disconnect/ws_send only;
  commands.rs:5-7 documents the deliberate omission). Verified by grep — no `secret_get` symbol
  exists anywhere in src.
- Secret scrubbing: `scrub()` replaces sensitive header VALUES in any emitted reason/error
  (reconnect.rs:134-141, sensitive = authorization/cookie/proxy-authorization, case-insensitive).
  Redacting `Debug` for ConnectConfig masks the same (types.rs:79-93, unit-tested). `AppError`
  built only from underlying Display (host/scheme, not our headers). Integration test
  `secret_token_never_appears_in_emitted_messages` serializes the whole emit log and asserts the
  token is absent. Heartbeat payload is timestamp-only (no secret). insecure_tls cannot become a
  silent global — it's per-connection config, default false, never written to a process-wide
  rustls default.

## Resource/task growth (d) — PASS

- One supervisor task per connect; self-cleanup removes the map entry on task exit
  (manager.rs:57-61). Integration test `connect_disconnect_loop_does_not_grow_conn_map` asserts 0
  after 5 cycles. Reconnect reuses the SAME task/rx/connId (no per-reconnect task spawn). Frame
  batch is bounded (256) and drained each flush; frontend buffer capped at MAX_FRAMES=400
  (use-workspace-store.ts:24,157). SEND_BUFFER=256 bounded mpsc. No unbounded growth found.

## Patterns / lint (e) — PASS

- New modules match existing style (module-doc header, inline `#[cfg(test)]`, kebab-not-needed for
  Rust). Files all <200 LOC except use-workspace-store.ts (documented exception, pre-existing).
  No obvious new clippy/type smells; `checked_shl`/`saturating_*` show overflow care.
  `interval_at` + `MissedTickBehavior::Delay` correct for steady cadence.

---

## Unresolved questions
1. (M2) Should the "Connected" uptime timer RESTART on reconnect, or count continuously across an
   outage? Current code counts continuously (stale connectedAt wins). Supervisor stamps a fresh
   `connected_at` that the frontend currently discards. Product call.
2. (Crit-(c) plan ask) Plan §Architecture wanted a Rust-side no-secret log line at connect when
   verification is disabled; not implemented. Add a `tracing`/`log` line, or accept the UI warning
   as sufficient? (No logging framework appears wired yet — confirm before adding.)
3. (M1) Acceptable to leave the connect/TLS handshake non-cancellable, or wrap it in the cancel
   select! to honor the "<300ms teardown, no further reconnect" guarantee in the connect-hang case?
4. (L2) Is `ChannelMsg::Error` meant to be consumed by the frontend (no `onError` exists)? Either
   wire it or drop the emit to keep the contract honest.

**Status:** DONE_WITH_CONCERNS
**Summary:** Phase 3 meets all 7 acceptance criteria; security/contract/resource checks pass. Two
Medium items (non-cancellable connect handshake M1; reconnect uptime-timer semantics M2) and minor
Lows warrant a product/eng decision but none block landing.
**Concerns:** M1 (teardown latency unbounded during a hanging connect — untested window) and M2
(timer counts across reconnects, discarding the fresh connected_at) — both correctness-adjacent,
neither data-loss nor security.
