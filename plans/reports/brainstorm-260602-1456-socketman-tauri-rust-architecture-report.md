# SocketMan — Tauri + Rust WebSocket/API Workbench — Brainstorm Summary

**Date:** 2026-06-02
**Status:** Approved by user — ready for `/ck:plan`
**Source design:** `design/` (Atomiton Relay static React prototype)

---

## 1. Problem Statement

Turn the existing static React prototype in `design/` (a WebSocket-first Postman alternative,
"Atomiton Relay") into a real cross-platform-capable desktop app, **SocketMan**, built on
**Tauri 2 + Rust backend + React/TS frontend**. Prototype networking is 100% simulated
(`data.js → makeServer()`); the real app needs actual WS/HTTP transport, persistence, and secret storage.

## 2. Confirmed Requirements (user decisions)

| Decision | Choice |
|---|---|
| Transport | **Rust backend** — tokio-tungstenite (WS) + reqwest (HTTP), bridged via Tauri commands+events |
| Frontend | **Port prototype → Vite + React + TypeScript** (reuse components/CSS) |
| v1 protocol scope | **WebSocket + real HTTP** |
| WS reliability v1 | **Auto-reconnect+backoff** + **heartbeat/ping-pong** (binary frames deferred) |
| Persistence | **JSON files** (app data dir) + **OS keychain** for secret tokens |
| Interop | **Own JSON format only** (no Postman import) |
| Platform | **Windows-first** (keep code cross-platform-friendly) |
| Product name | **SocketMan** (strip Atomiton branding, replace demo data with starter content) |

### Expected output
Working Tauri desktop app: real WS connect/send/receive with live frame log, real HTTP requests,
collections + saved messages + environments persisted to disk, secrets in keychain.

### Acceptance criteria
- Connect to a real `wss://` endpoint **with a custom `Authorization` header on the upgrade request**; see live frames.
- Auto-reconnect after a dropped socket; heartbeat keeps connection alive + reports RTT.
- Send a real HTTP GET/POST and view status/headers/body/timing.
- Collections/environments survive app restart; secret env vars never stored in plaintext on disk.
- UI visually matches the prototype.

### Out of scope (v1)
Binary WS frames, Postman/Insomnia import, SSE/Socket.IO/MQTT, macOS/Linux builds.

## 3. Why Rust-backend transport (key rationale)
The prototype's Auth pane sends a token in the **Authorization header on the WS upgrade request**.
The **browser `WebSocket` API cannot set arbitrary upgrade headers** — so the webview-WS approach
was rejected. Rust (tokio-tungstenite) builds the upgrade request manually → full control over
headers, auth, TLS/self-signed certs, proxies, reconnect, heartbeat, and background connections.

## 4. Architecture

### Process model
- **Webview (React+TS):** UI ported from prototype; `transport.ts` calls Tauri `invoke()` for
  commands and `listen()` for events. The fake `makeServer()` + `setInterval` tick are **removed**.
- **Rust core (`src-tauri`):** connection manager (per-connection tokio task), HTTP client, JSON
  storage, keychain secrets.

### IPC contract
**Commands (UI → Rust):** `ws_connect(config) → conn_id` · `ws_disconnect(conn_id)` ·
`ws_send(conn_id, payload)` · `http_send(request) → response` · `storage_load/save` ·
`secret_set/get/delete`

**Events (Rust → UI):** `ws://frame {conn_id, dir, kind, body, ts, size}` ·
`ws://status {conn_id, status, connectedAt, reason, code}` · `ws://error`

These map 1:1 onto existing prototype state (`addFrames`, `setConns`).

### Rust module layout (`src-tauri/src/`)
- `ws/manager.rs` — `HashMap<ConnId, Handle>`, mpsc senders to per-connection tasks
- `ws/connection.rs` — per-conn task: read loop→emit frames, write loop, reconnect+backoff state machine, heartbeat timer
- `ws/types.rs` — `Frame, ConnStatus, ConnectConfig` (url, headers, auth, heartbeat_secs, reconnect policy)
- `http/client.rs` — reqwest send → status/headers/body/timing
- `storage/store.rs` — JSON load/save · `storage/secrets.rs` — keyring wrapper
- `commands.rs` (thin handlers) · `events.rs` (payload types)

### Persistence & secrets
`%APPDATA%/SocketMan/`: `collections.json`, `environments.json`, `history.json`.
UI-only prefs (panel widths, tweaks, dark mode) stay in localStorage.
Secret env vars → OS keychain (`keyring`) under `socketman:{envId}:{key}`. Frontend stores only
`{key, secret:true}` refs. **Secret `{{token}}` placeholders resolve Rust-side at send/connect time**
(plaintext tokens never enter JS heap); non-secret `{{vars}}` resolve in frontend via existing `resolveEnv`.

### Frontend port notes
- `.jsx`→`.tsx`; drop `window.X` globals → ES imports; type the IPC contract (mirror Rust types).
- **Modularize per 200-line rule:** `app.jsx` (437 lines) → hooks (`useConnections`, `useCollections`,
  `useEnvironments`, `usePanels`); `formats.jsx` (267) → split serialize / parse / views.
- Rebrand Atomiton→SocketMan; replace demo collections with starter content.

## 5. Phased Roadmap

| Phase | Deliverable |
|---|---|
| 0 | Scaffold Tauri+Vite+React+TS; port UI verbatim with **mock transport** (visual parity) |
| 1 | Rust WS engine + IPC; real connect/send/receive log |
| 2 | Auto-reconnect+backoff + heartbeat/ping-pong |
| 3 | Real HTTP client (reqwest) — build out `HttpWorkspace` |
| 4 | JSON storage + keychain secrets + env resolution |
| 5 | Rebrand SocketMan, starter data, wire up History |
| 6 | Windows installer/packaging |

## 6. Risks & Mitigations
- **IPC flood from high-rate streams** → batch/coalesce frames in Rust (~50–100ms windows), cap buffer, backpressure.
- **Custom headers + self-signed TLS** in tokio-tungstenite → manual request build + rustls config.
- **Hand-rolled YAML/XML parsers lossy** → keep for v1, document limits; consider `serde_yaml`/`quick-xml` later.

## 7. Unresolved Questions
- None blocking. (Future: cross-platform keychain testing, frame virtualization for very large logs.)
