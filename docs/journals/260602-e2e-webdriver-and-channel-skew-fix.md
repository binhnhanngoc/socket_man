# Journal — Tauri WebDriver e2e + a real channel-delivery bug

**Date:** 2026-06-02 · **Scope:** set up `tauri-driver` e2e; it surfaced a shipping bug.

## What was built

- **tauri-driver e2e harness** (`e2e/`): `tauri-driver` 2.0.6 + version-matched `msedgedriver` 148 (in `.tools/`, gitignored), driven by a **zero-dependency Node W3C-WebDriver client** (`tauri-e2e.mjs`) + a runner (`run-e2e.mjs`) that boots a **hermetic local echo server** (`local-echo-server.mjs`, `ws` + `node:http`) so the test needs no external network. `npm run e2e`.
- Scenario (all green): app boots + brand renders → WS connects to a local echo → inbound greeting frame → send message echoes back (1→3 frames) → HTTP GET returns 200.

## The bug it caught (would have shipped)

WS/HTTP did nothing at runtime in the packaged app: status stuck on the frontend's optimistic "Connecting…", no frames. Root cause, isolated via a direct `__TAURI_INTERNALS__.invoke` probe: the command resolved and **3 channel messages arrived**, each shaped `{message, index}` — but the bundled **`@tauri-apps/api` 2.1.1** Channel destructured `{message, id}` (core.js). The Rust **`tauri` crate 2.11.2** had renamed that ordering field `id`→`index`; with `id` undefined the Channel's in-order dispatch never fired `onmessage`, so no `ChannelMsg` (status/frame) ever reached React.

**Fix:** bump `@tauri-apps/api` 2.1.1 → **2.11.0** and `@tauri-apps/cli` 2.1.0 → **2.11.2** to match the Rust crate; new core.js reads `index`. Rebuilt; e2e then passed 5/5.

**Why headless tests missed it:** Rust integration tests use a `Vec` collector in place of the Tauri `ipc::Channel`, and Vitest uses the mock transport — neither exercises the real JS↔Rust Channel bridge. Only a real-webview e2e does.

## Lesson

Pin the JS `@tauri-apps/*` packages and the Rust `tauri` crate to the same minor. A real-webview smoke (`npm run e2e`) belongs in CI — it's the only layer that catches IPC/Channel protocol skew.
