# Journal — Phase 3: WS Reliability

**Date:** 2026-06-02 · **Plan:** 260602-1457-socketman-tauri-rust-workbench · **Mode:** `/cook` (TDD)

## What shipped

Auto-reconnect (capped exponential backoff 1→2→4→8→16→30s + jitter, reset on success),
heartbeat ping/pong with RTT, explicit dead-socket detection, inbound frame coalescing
(~80ms / 256-cap), flush-before-status ordering, per-connection insecure-TLS toggle (full
MITM disable, OFF by default, re-warned at every connect + red badge), live Settings (only
auto-reconnect + insecure-TLS; rest read-only labels).

## Backend (`src-tauri/src/ws/`)

- `backoff.rs`, `heartbeat.rs` — pure state machines, unit-tested first (TDD keystones).
- `cancel.rs` — hand-rolled `Cancel` on `tokio::sync::Notify` + sticky `AtomicBool`. See decision below.
- `tls.rs` — `tls_mode` (always-tested selection) + `insecure_connector` (rustls danger verifier
  accepting any cert/hostname) + `connect_ws` secure/insecure branch.
- `connection.rs` — `run_connection` rewritten to `select!` over read / ping tick / rx / coalesce /
  cancel; returns `RunEnd::{Cancelled, Dropped}` (terminal vs reconnectable).
- `reconnect.rs` — supervising loop; interruptible backoff AND interruptible connect handshake;
  exactly one terminal `disconnected` per exit path; secret scrubbing.
- `manager.rs` — per-conn `Cancel`; `disconnect`/`shutdown_all` cancel then drop.
- `types.rs` — `ConnectConfig` + `heartbeatSecs`/`reconnect{enabled,maxBackoffSecs}`/`insecureTls`
  (camelCase serde defaults; minimal `{url,headers}` still deserializes — contract preserved).

## Frontend

`transport.ts` optional config fields · `ConnMeta` + reconnect/insecureTls · `ConnState.rttMs` ·
store builds config + `window.confirm` MITM gate at every connect + connectedAt-preserve-across-RTT ·
live `SettingsPane` · ConnectionBar RTT/red badge/Reconnecting… · CSS.

## Key decisions

- **Hand-rolled `Cancel` instead of `tokio-util::CancellationToken`.** This environment has NO network
  for cargo; `tokio-util` was not in the offline crate cache, so its download failed the build. Built the
  same contract (`is_cancelled`/`cancelled`/`cancel`, cloneable) on `Notify`; the cancel-vs-await race is
  closed with `Notified::enable()` before a second flag re-check (unit-tested 3 ways). `bytes` + `rustls`
  WERE cached (rustls already a dev-dep) so they became direct deps without a download.
- **Coalesce everything (in + out + sys) into one ordered batch**, flushed on the 80ms tick / at cap /
  before any status — gives the flush-before-status ordering contract for free.
- **RTT rides a `connected` status with no `connected_at`**; a real reconnect stamps a fresh
  `connected_at`. Frontend distinguishes them: `s.connectedAt ?? c.connectedAt` → timer restarts on
  reconnect, never resets on a heartbeat tick.

## Code review (DONE_WITH_CONCERNS → resolved)

All 7 acceptance criteria met, no Critical/High. Applied both Mediums: M1 (made the connect handshake
cancellable so disconnect during a hanging connect is instant, not OS-timeout-bound) and M2 (timer no
longer counts across a reconnect). Lows deferred (cosmetic). Q: plan's Rust-side "verification disabled"
log not added — no logging framework is wired; the at-every-connect MITM warning + red badge is the
honest control.

## Tests

Rust 21 unit + 10 integration (+1 `#[ignore]`d self-signed, passes with `-- --ignored`); frontend
`tsc --noEmit` clean + 29 vitest. All green. `cargo` invoked via full path with `--offline`.

## Unresolved / deferred

- 20-cycle live-reconnect soak + ≥500 frames/s stream stay as manual E2E (step 8): each real reconnect
  waits a genuine ≥1s backoff, so an automated 20× loop would be ~30s+ of wall-clock.
- Future phases (4 reqwest, 5 keyring) MUST confirm those crates are already in the offline cache or the
  build will fail the same way `tokio-util` did.
