---
phase: 3
title: "WS Reliability"
status: done
priority: P1
effort: "2-3d"
dependencies: [2]
---

> **Red-team applied (2026-06-02):** concrete `awaiting_pong` heartbeat state (F2), flush frame batch
> before emitting Status (F5), cancel arm in connection + backoff `select!` (F7), honest TLS-disable
> toggle naming + connect-time re-warn + persistence decision (F11), **hardcoded reliability defaults —
> Settings stays mostly display-only like the prototype** (F18), attempt-count cut (F19), `ConnectConfig`
> gains `heartbeatSecs`/`reconnect`/`insecureTls` HERE (F24), self-signed test `#[ignore]`-by-default (F26).

# Phase 3: WS Reliability

## Overview

Make connections survive flaky networks: **auto-reconnect with capped exponential backoff**,
**heartbeat ping/pong with RTT measurement**, and **dead-socket detection** (missed pongs force a
reconnect). Also land **frame coalescing** (batch inbound frames in ~50–100ms windows) so high-rate
streams don't flood IPC, and the **self-signed TLS danger toggle**. The Settings pane (currently
static in the prototype) becomes live-bound to these knobs.

## Key Insights

- Reconnect wraps the connection task in a supervising loop: on read error / dead-socket → emit
  `reconnecting`, sleep `backoff.next()`, rebuild request, reconnect; on success → reset backoff, emit
  `connected`. The **write `(tx,rx)` was hoisted to the manager in Phase 2 (F4)**, so `tx` and the connId
  are already stable across reconnects — the supervising loop only swaps the socket and re-borrows `rx`.
- **Heartbeat dead-detection needs explicit state (F2).** Do NOT wrap the ping loop in a single timeout
  (the research §4 example is structurally dead — it never observes pongs). Track `awaiting_pong: bool`
  and `last_ping_at: Instant` inside the connection `select!`: on `ping_interval.tick()` → if
  `awaiting_pong` is *still true*, the previous pong never came ⇒ **that is the dead signal, break to
  reconnect**; else send `Ping(now_ms)`, set `awaiting_pong=true`. On `Pong(p)` → RTT = now − decode(p),
  `awaiting_pong=false`. tungstenite auto-answers inbound `Ping`; this is our *outbound* liveness probe.
- **Ordering contract (F5):** `Frames` batch and `Status` share one ordered channel but flush on
  different cadences (frames on a coalesce timer, status inline). On every status transition, **flush the
  pending frame batch FIRST, then emit `Status`** — so the frontend never sees frames for a conn whose
  status is not yet `connected` (matches the prototype's status-before-frames assumption, `app.jsx:279`).
- Coalescing uses the same `select!` over `read.next()` + a coalesce `interval.tick()`, flushing a bounded
  batch (cap ~256). `ConnStatus.rttMs` rides status updates.
- **Cancellation (F7):** a `CancellationToken`/`Notify` per conn. The inner connection `select!` has a
  `_ = cancel.notified() => break` arm (so disconnect on an idle connected socket is instant), AND the
  supervising loop wraps its backoff wait in `select! { _ = sleep(delay) => {}, _ = cancel.notified() => break }`
  so `ws_disconnect` during a 30s backoff is immediate and **no further reconnect is attempted**.
- **TLS disable toggle (F11, honest).** `insecureTls` disables **all** cert-chain, expiry, AND hostname
  verification (full MITM exposure) — not merely "accept self-signed". Default OFF. Prefer a pinned-cert
  verifier where feasible over accept-all. Decide persistence explicitly (see Architecture); if it
  persists on the item, re-show the warning and badge the ConnectionBar red **at every connect**, and log
  (without secrets) that verification was disabled.

## Requirements

**Functional**
- Auto-reconnect after a dropped socket; exponential backoff **capped at a hardcoded 30s**; `reconnecting`
  status surfaced (status KIND only — **no attempt-count** in the contract/UI, F19); backoff resets on success.
- Heartbeat: **hardcoded 30s interval**; each cycle reports RTT (`rttMs`); the ConnectionBar shows last RTT.
- Dead-socket: missed pong by the next interval → force reconnect (not a silent hang).
- Frame coalescing: inbound frames delivered in batches every **~80ms (hardcoded)**, bounded buffer (256).
- Self-signed/insecure toggle: per-connection `insecureTls` disables ALL TLS verification for that
  connection; OFF by default; explicit per-connection opt-in with a clear MITM warning.
- **Settings pane (F18 — match the prototype, mostly DISPLAY-ONLY).** The prototype shows static labels
  (`design/app.jsx:115-126`). v1 keeps it that way: live controls ONLY for **auto-reconnect on/off** and
  the **per-connection insecure-TLS toggle + warning**. Heartbeat (30s), backoff cap (30s), coalesce
  (~80ms), max log buffer (400 = existing `MAX_FRAMES`) are **hardcoded defaults shown as read-only
  labels** — no editable controls, no validation, no persistence. (Expose as settings later only if asked.)

**Non-functional**
- Backoff + heartbeat logic unit-tested as pure state machines (deterministic, no real sockets).
- Reconnect storms bounded; no unbounded task/memory growth across many reconnect cycles.

## Architecture

### Supervising reconnect loop (`ws/reconnect.rs`) — cancel-aware backoff (F7)
```
loop {
  if cancel.is_cancelled() { break }
  match connect(&cfg).await {            // re-borrows the hoisted &mut rx; reuses connId
    Ok(ws) => { backoff.reset(); flush_then_emit(Connected);
                run_connection(ws, &mut rx, &channel, &hb, &cancel).await; // returns on close/error/cancel
                if cancel.is_cancelled() || !cfg.reconnect.enabled { break }
                flush_then_emit(Reconnecting) }
    Err(e) => { flush_then_emit(Reconnecting{reason: sanitize(e)}) }   // sanitize: no secrets (F13)
  }
  if cancel.is_cancelled() { break }
  select! {                              // backoff wait is INTERRUPTIBLE (F7)
    _ = sleep(backoff.next_delay()) => {}     // 2^attempt capped at 30s + jitter
    _ = cancel.notified()           => break  // ws_disconnect mid-backoff → instant, no reconnect
  }
}
```

### Connection `select!` (`ws/connection.rs`) — heartbeat state + flush-before-status + cancel (F2/F5/F7)
```
let mut awaiting_pong = false; let mut last_ping = Instant::now();
loop {
  select! {
    msg = read.next() => match msg {
      Some(Ok(Pong(p))) => { rtt = now - decode(p); awaiting_pong = false;
                             flush_batch(); emit Status{rttMs: rtt} }   // flush THEN status (F5)
      Some(Ok(m))       => { batch.push(frame(m)); if batch.len() >= 256 { flush_batch() } }
      Some(Err(e))      => { flush_batch(); break }                     // dead → supervisor reconnects
      None              => { break }
    },
    _ = ping_interval.tick() => {
      if awaiting_pong { break }          // previous pong never arrived ⇒ DEAD (F2) → reconnect
      write.send(Ping(now_ms)).await?; awaiting_pong = true; last_ping = Instant::now();
    },
    cmd = rx.recv() => match cmd { Some(m) => write.send(m).await?, None => { write.close().await.ok(); break } },
    _ = coalesce_interval.tick() => { if !batch.is_empty() { flush_batch() } },
    _ = cancel.notified() => { write.close().await.ok(); break },       // instant disconnect (F7)
  }
}
```
- `ExponentialBackoff { attempt, max_delay_secs: 30 }` → `2^attempt` capped at 30 (+ small jitter).
- `flush_then_emit(status)` / `flush_batch()` enforce the ordering contract: pending frames go out before
  any status, so the channel's order matches logical order.

### Coalescing
Replace Phase 2's per-frame send with a `Vec<Frame>` batch flushed on the coalesce interval or when it
hits the cap; `ChannelMsg::Frames{batch}` already supports it; the frontend `onFrame(f: Frame[])` is
already batch-shaped from Phase 1.

### ConnectConfig extension (F24) + TLS selection (`ws/tls.rs`)
This phase adds the deferred fields to the TS `Transport.ConnectConfig` and the Rust mirror:
`heartbeatSecs?` (default 30, currently fixed), `reconnect?: { enabled: boolean; maxBackoffSecs: 30 }`,
`insecureTls?: boolean`. Only `reconnect.enabled` and `insecureTls` are user-visible in v1 (per F18).
```
if cfg.insecure_tls { connect_async_tls_with_config(req, None, false, Some(insecure_connector())) }
else                { connect_async(req) }  // native roots (rustls-tls-native-roots)
```
**`insecureTls` persistence decision (F11):** it rides in the per-item connect config. Because the
collection item is persisted (Phase 5), a `true` value WOULD survive restart silently. v1 rule: persist
it, but (a) ConnectionBar shows a **red "TLS verification OFF" badge whenever it's true**, (b) the MITM
warning re-appears **at every connect**, not just at toggle time, and (c) connect logs a no-secret line
noting verification was disabled. (Alternative considered: session-only/non-persisted — rejected so a
saved self-signed dev endpoint stays usable, but the connect-time warning is mandatory.)

## Related Code Files

**Create:** `src-tauri/src/ws/{reconnect,heartbeat,backoff,tls}.rs`;
`src-tauri/src/ws/__tests__`-equivalent inline `#[cfg(test)]` modules; add cases to `tests/ws_integration.rs`.

**Modify:** `ws/connection.rs` (run_connection now driven by select! with heartbeat + coalesce),
`ws/manager.rs` (store cancellation token per conn), `ws/types.rs` (add `rttMs`, `attempt`, reconnect
fields), `src/components/ws-tab-panes.tsx` (Settings pane → live controls), `src/components/connection-bar.tsx`
(show RTT), `src/hooks/use-connections.ts` (thread settings into ConnectConfig).

## Implementation Steps (TDD)

1. **TDD — backoff (`backoff.rs` `#[cfg(test)]`):** assert sequence `1,2,4,8,16,30,30,…` capped at 30,
   and `reset()` returns to start. Implement `ExponentialBackoff`.
2. **TDD — heartbeat state machine (F2):** unit-test ping-payload encode/decode + RTT from a known
   `now`/`pong` pair; unit-test the transition **"`awaiting_pong` still true at next tick ⇒ dead"** and
   "`Pong` clears `awaiting_pong`". Implement the state, not a wrapping timeout.
3. **TDD — coalescer:** feed a synthetic stream of N frames faster than the interval; assert they
   arrive as ≤cap batches and the timer flushes a partial batch. Implement the `select!` coalescer
   (extract flushing logic so it's testable without a socket).
4. **Integration — reconnect:** extend the in-test echo server to drop the connection once; assert the
   manager emits `reconnecting` then `connected` again and the same `connId`/send path still works.
5. **Integration — heartbeat + ordering + cancel:** (a) echo server answering pings → assert
   `Status{rttMs}` arrives; a server that ignores pings ⇒ dead-detection reconnects. (b) **Ordering
   (F5):** server sends connected→burst→drop; assert the frontend never receives `Frames` while its
   status for that conn is not `connected`. (c) **Cancel (F7):** issue `ws_disconnect` while the loop is
   in a backoff sleep → teardown completes <100ms and **no further `connect()` is attempted**.
6. **Self-signed (F26):** `#[ignore]`-by-default integration test against a locally-generated self-signed
   `wss://` server — fails with `insecureTls:false`, succeeds with `true`. Unit-test the toggle/verifier
   selection logic (not `#[ignore]`d) so the security branch is always covered; cert-gen stays optional.
7. **Settings UI (F18 — minimal):** bind ONLY auto-reconnect on/off + the per-connection insecure-TLS
   toggle (with MITM warning + red badge). Render heartbeat/backoff/coalesce/buffer as read-only labels
   with the hardcoded values. Show RTT in ConnectionBar. Do NOT build editable controls/validation/
   persistence for the hardcoded knobs.
8. **Gate:** `cargo test` + `npm test` green; manual E2E: kill network mid-stream, watch reconnect; RTT ticks.

## Todo List

- [x] Backoff state-machine test first, then green (capped exponential + reset) — `ws/backoff.rs`
- [x] Heartbeat `awaiting_pong` state test first, then green (next-tick-still-awaiting ⇒ dead; pong clears) — `ws/heartbeat.rs`
- [x] Coalescer green (bounded 256 batches + ~80ms timed flush) — `ws/connection.rs`
- [x] Ordering test: no `Frames` delivered while conn status ≠ `connected` (flush-before-status) — `frames_never_precede_connected_status`
- [x] Reconnect integration test (server drops once) green — `reconnect_after_drop_reuses_conn_and_send_path`
- [x] Heartbeat integration test (RTT updates + dead→reconnect) green — `heartbeat_reports_rtt`, `dead_socket_missed_pong_drops_for_reconnect`
- [x] Cancel test: `ws_disconnect` during backoff tears down instantly, no further connect — `disconnect_during_backoff_is_instant_and_stops_reconnect` (+ connect-handshake now also cancellable)
- [x] Self-signed TLS toggle: verifier-selection unit-tested; `#[ignore]`d cert integration test present (passes with `-- --ignored`)
- [x] Settings: only auto-reconnect + insecure-TLS are live; rest are read-only labels (hardcoded)
- [x] RTT shown in ConnectionBar; red badge when insecureTls on; MITM warning at every connect
- [x] `ConnectConfig` extended with heartbeatSecs/reconnect/insecureTls (Rust + TS mirror)
- [x] No `reconnecting` attempt-count in contract/UI

## Success Criteria

- [x] Acceptance: after a dropped socket the connection auto-reconnects (backoff visible); heartbeat
      keeps it alive and reports RTT. — verified by `reconnect_after_drop_*` + `heartbeat_reports_rtt`.
- [x] High-rate stream does not stall the UI (frames coalesced in ~80ms / 256-cap batches). — coalescer in
      `run_connection`; ≥500 frames/s soak is manual E2E (step 8).
- [x] Self-signed `wss://` connects only when the danger toggle is on. — `self_signed_connects_only_with_insecure_toggle`
      (`#[ignore]`d; passes with `-- --ignored`) + `ws::tls` unit tests.
- [x] No conn-map/task growth across connect/disconnect cycles (loop test). — `connect_disconnect_loop_does_not_grow_conn_map`;
      20-cycle live-reconnect soak is manual E2E (each reconnect waits a real ≥1s backoff).
- [x] `cargo test` + `npm test` green. — 21 unit + 10 integration (+1 ignored) Rust; tsc + 29 vitest.

## Risk Assessment

- **Reconnect after explicit disconnect** (bug class) → cancel arm in BOTH the inner `select!` and the
  backoff wait (F7); explicit cancel test. Not just a flag checked at loop-top.
- **Dead socket never detected** (half-open, no FIN/RST) → `awaiting_pong` state makes a missed pong the
  trigger at the next interval (F2); covered by the ignore-pings integration test.
- **Frames/status reorder** → flush-before-status contract (F5); ordering integration test.
- **Backoff thundering herd** → add jitter; single-connection app makes this minor.
- **Self-signed test infra cost** → `#[ignore]`d integration test; verifier-selection logic unit-tested
  always; never skip the toggle logic.
- **Pong matching ambiguity** if multiple pings outstanding → one ping per interval; `awaiting_pong`
  guarantees at most one outstanding.

## Security Considerations

- `insecureTls` is a footgun: default OFF, require explicit per-connection opt-in, render a visible
  warning, never persist it as a global default.
- Heartbeat payload carries only a timestamp — no secrets.

## Next Steps

Phase 4 adds the real HTTP client (independent of WS; can be built in parallel with 2/3 if staffed).
