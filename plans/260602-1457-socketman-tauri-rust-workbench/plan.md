---
title: "SocketMan — Tauri 2 + Rust WS/HTTP Workbench (TDD)"
description: "Turn the static Atomiton Relay React prototype into SocketMan: a real Tauri 2 + Rust desktop app with live WebSocket + HTTP transport, JSON persistence, and OS-keychain secrets."
status: pending
priority: P2
branch: ""
tags: [tauri, rust, react, typescript, websocket, tdd]
blockedBy: []
blocks: []
created: "2026-06-02T08:02:22.346Z"
createdBy: "ck:plan"
source: skill
---

# SocketMan — Tauri 2 + Rust WS/HTTP Workbench (TDD)

## Overview

Port the static React prototype in `design/` (Atomiton Relay — a WebSocket-first Postman
alternative, 100% simulated transport) into **SocketMan**: a real **Tauri 2 + Rust backend +
React/TS frontend** desktop app. Rust owns transport (tokio-tungstenite WS + reqwest HTTP),
bridged to the webview via Tauri commands + `ipc::Channel` streaming. Persistence is JSON files
in the app data dir; secret tokens live in the OS keychain. Windows-first, cross-platform-friendly.

The hard requirement that drives the whole architecture: send a custom `Authorization` header on
the **WS upgrade request** — impossible with the browser `WebSocket` API, trivial in Rust.

**Mode:** `--tdd` — every phase writes its tests (Rust `#[cfg(test)]` / integration + Vitest)
before or alongside implementation. Tests gate phase completion. **No mocks/fakes to pass CI.**

## Phases

| Phase | Name | Status | Deliverable |
|-------|------|--------|-------------|
| 1 | [Scaffold & UI Port](./phase-01-scaffold-ui-port.md) | ✅ Done | Tauri+Vite+React+TS app; UI ported to `.tsx` behind a `Transport` interface (mock impl); visual parity; format round-trip tests green |
| 2 | [Rust WS Engine & IPC](./phase-02-rust-ws-engine-ipc.md) | ✅ Done | Real `ws_connect/send/disconnect` + frame/status Channel; custom upgrade headers; live log |
| 3 | [WS Reliability](./phase-03-ws-reliability.md) | Pending | Auto-reconnect + capped backoff; heartbeat ping/pong with RTT; dead-socket detection |
| 4 | [HTTP Client](./phase-04-http-client.md) | Pending | Real `http_send` (reqwest) with status/headers/body/timing; wired `HttpWorkspace` |
| 5 | [Persistence & Secrets](./phase-05-persistence-secrets.md) | Pending | JSON store (collections/environments/history) + keychain secrets + Rust-side secret `{{token}}` resolution |
| 6 | [Rebrand & History](./phase-06-rebrand-history.md) | Pending | Atomiton→SocketMan rebrand, starter data, History panel wired to persisted log |
| 7 | [Windows Packaging](./phase-07-windows-packaging.md) | Pending | Signed-optional MSI/NSIS installer + icons + release build |

## Key Decisions (locked in brainstorm — do not silently reverse)

- **Transport:** Rust — `tokio-tungstenite` (WS) + `reqwest` (HTTP). Browser WS rejected (no upgrade headers).
- **Streaming:** Tauri 2 `ipc::Channel<T>` per connection — a single tagged `ChannelMsg` enum (`Frames`/`Status`/`Error`). **This supersedes the brainstorm §4 `emit()` events** (`ws://frame`/`ws://status`/`ws://error`); `ws://error` maps to `ChannelMsg::Error`. **Tauri v2 `Channel.onmessage` is a property setter** (`channel.onmessage = cb`), NOT an awaitable method — the Tauri IPC research report's `await channel.onmessage(cb)` snippet is WRONG; do not copy it.
- **TLS:** `rustls` + `rustls-tls-native-roots` (Windows cert store). Self-signed = explicit per-connection **WS** toggle that disables ALL cert+hostname verification (true MITM risk — named honestly, re-warned at connect, not a silent persisted default). HTTP stays strict (one client, no insecure HTTP path in v1).
- **Secret resolution is Rust-only and private:** `secret_get` is **never** registered as a Tauri command (registering = exposing to webview JS/XSS). The frontend resolver **skips secret keys** (leaves `{{secret}}` literal); only `ws_connect`/`ws_send`/`http_send` substitute secrets, Rust-side, on the outbound path. History/frame logs are assembled **Rust-side** and store templates, never resolved values.
- **Persistence:** JSON files in `%APPDATA%/SocketMan/`. UI-only prefs stay in `localStorage`.
- **Secrets:** OS keychain via `keyring`; plaintext secret tokens **never enter the JS heap** — resolved Rust-side at send/connect.
- **Interop:** Own JSON format only (no Postman import). **Platform:** Windows-first.
- **v1 out of scope:** binary WS frames, SSE/Socket.IO/MQTT, macOS/Linux builds, Postman import.

## Dependencies

- **External:** Node 18+, Rust 1.78+ (MSVC), WebView2 (preinstalled Win11), VS 2022 C++ build tools.
- **Crates (verify + PIN before first build):** tauri 2.11, tokio 1, tokio-tungstenite 0.29 (`rustls-tls-native-roots`), reqwest 0.13, keyring 4, serde/serde_json, thiserror, http 1, futures. Versions appear valid as of 2026-06 (reqwest 0.13.4, keyring 4.0.1) but MUST be confirmed via `cargo add --dry-run`, **pinned**, `Cargo.lock` committed, and a `cargo audit`/`cargo-deny` CI gate added (keyring 4.0.x is recent — no soak; supply-chain hygiene required).
- **Backend skeleton (Phase 1.5, shared seam):** before Phase 2/4 diverge, create the shared backend base — `error.rs`/`AppError`, the `lib.rs` builder + `generate_handler!` registry (one handler per line, alphabetized), and the `Cargo.toml` dependency block. Phases 2 and 4 then own **disjoint** modules (`ws/` vs `http/`) and only append to the shared registry, minimizing merge conflicts.
- **Cross-plan:** none (greenfield; no other unfinished plans in `./plans`).
- **Phase order:** 1 → **1.5 skeleton** → {2, 4 can parallelize on disjoint modules} → 3 (needs 2) → 5 (needs 2+4) → 6 (needs 5) → 7 last. "Parallel" 2/4 still share `lib.rs`/`Cargo.toml`/transport TS — coordinate via the skeleton, not free-for-all.

## Source Artifacts

- Brainstorm: `plans/reports/brainstorm-260602-1456-socketman-tauri-rust-architecture-report.md`
- Research (Tauri IPC): `plans/reports/researcher-260602-1457-tauri2-ipc-streaming-scaffolding-report.md`
- Research (Rust stack): `plans/reports/researcher-260602-1457-rust-ws-http-keychain-stack-report.md`
- Prototype: `design/*.jsx`, `design/*.css`, `design/data.js`

## Red Team Review

### Session — 2026-06-02
**Findings:** 27 (27 accepted, 0 rejected) from 4 hostile reviewers (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic).
**Severity breakdown:** 5 Critical, 11 High, 11 Medium.

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Frontend resolver must skip secret keys (`{{secret}}` stays literal in JS) | Critical | Accept | P1, P4, P5 |
| 2 | History/frames assembled Rust-side; mask resolved secrets in render | Critical | Accept | P5, P6 |
| 3 | Never register `secret_get` as a Tauri command | Critical | Accept | P5 |
| 4 | Single-task `select!`; hoist channel ownership + stable connId across reconnect | Critical | Accept | P2, P3 |
| 5 | Concrete heartbeat `awaiting_pong` state for dead-socket detection | Critical | Accept | P3 |
| 6 | `Channel.onmessage` is a property setter (research report snippet wrong) | High | Accept | P2 |
| 7 | Format round-trip: JSON lossless gated; YAML/XML view-only (no xfail-as-green) | Critical→High | Accept | P1 |
| 8 | Flush frame batch before emitting Status (ordering contract) | High | Accept | P3 |
| 9 | Cancel arm in connection + backoff `select!`; disconnect never reconnects | High | Accept | P3 |
| 10 | connId runtime-only, never copied on duplicate | High | Accept | P2 |
| 11 | Rename insecure-TLS toggle; re-warn at connect; pinned-cert preference | High | Accept | P3, P1 |
| 12 | Exact tight production CSP + CI assertion | High | Accept | P1, P7 |
| 13 | Redacting `Debug` for ConnectConfig/headers; sanitize AppError/reason | High | Accept | P2, P3 |
| 14 | Wire Headers/Auth panes → ConnectConfig.headers (the Authorization path) | High | Accept | P2 |
| 15 | Coordinating workspace store for cross-state ops; 200-LOC as target+exception | High | Accept | P1 |
| 16 | Backend skeleton seam; fix Phase 4 "independent" claim | High | Accept | plan, P2, P4 |
| 17 | Cut dual reqwest client / symmetric HTTP insecureTls (gold-plating) | High | Accept | P4 |
| 18 | Hardcode reliability defaults; cut configurable Settings controls | High | Accept | P3 |
| 19 | Cut "reconnecting attempt-count" UI (keep status kind) | Medium | Accept | P3 |
| 20 | Keychain key encoding/validation + orphan sweep on rename/delete | Medium | Accept | P5 |
| 21 | Validate resolved secret values (reject CRLF in headers, encode URL) | Medium | Accept | P5 |
| 22 | Rewrite `useTweaks` to persist to localStorage (no host post-port) | Medium | Accept | P1 |
| 23 | Pin crate versions + commit Cargo.lock + `cargo audit` gate | Medium | Accept | plan, P2 |
| 24 | Keep Phase 1 `ConnectConfig` minimal `{url, headers}`; extend in P3 | Medium | Accept | P1, P3 |
| 25 | Add `ChannelMsg::Error` variant; reconcile brainstorm emit-events | Medium | Accept | P2 |
| 26 | Trim test infra to proportionate (keep TDD keystones) | Medium | Accept | P3, P4 |
| 27 | Widen/split Phase 1 effort; scope visual-parity concretely | Medium | Accept | P1 |

User decision: **Apply all accepted.** Scope cuts (17/18/19) remove Claude-added gold-plating only — user-confirmed scope (Rust transport, keychain, JSON files, WS+HTTP, Windows-first, self-signed WS toggle, reconnect+heartbeat+RTT) is preserved.

### Whole-Plan Consistency Sweep — 2026-06-02
Re-read `plan.md` + all 7 phase files after applying findings. Decision deltas verified consistent end-to-end:
- **Single-task `select!`** is the sole WS topology — no surviving "two-task split" as a chosen design (only negations).
- **`secret_get` never registered** — no call site or exposed-command reference remains; resolution is a private Rust fn everywhere.
- **History append is Rust-side** in Phases 5 & 6 — no frontend read-modify-write of connection state remains.
- **Reliability defaults hardcoded** (Phase 3) — Settings is display-only except auto-reconnect + insecure-TLS; no "configurable" WS knobs survive (Phase 4's HTTP *timeout* is unrelated). No `attempt-count` in contract/UI.
- **`ConnectConfig` minimal in P1** (`{url, headers}`), extended in P3 — Phase 2 `types.rs` mirror carries no reliability/TLS fields.
- **`Channel.onmessage` setter form** consistent; the only `await onmessage(cb)` references are explicit "this is wrong" warnings.
- **`resolveEnv(..., {skipSecret})`** threaded through P1 (test), P4 (HTTP), P5 (resolution) — secret tokens stay literal in JS at every site.

**Result: zero unresolved contradictions.** Plan is internally consistent and ready for implementation.
