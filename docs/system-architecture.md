# SocketMan System Architecture

**Overview:** A Tauri 2 desktop app bridging a React/TypeScript UI with a Rust transport backend — a WebSocket/HTTP workbench. Seven core phases complete (mock transport → real WS engine + IPC → WS reliability → HTTP client → JSON persistence + OS keychain → rebrand + history → Windows packaging). Track 1 (UX & Polish) adds 5 phases: notifications, copy/save/export, search/filter + virtualization, code-gen, and lossless YAML via `js-yaml`. A WebDriver e2e harness exercises the real WebView2↔Rust bridge. The only open acceptance item is a manual GUI install smoke test (cannot run headlessly).

## Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     React/TypeScript UI (Vite)                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Components (sidebar, library, ws/http workspaces)       │   │
│  │  State Hooks (workspace store, env, panels, tweaks)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Transport Interface
                           │ (connId/frames/status/http)
┌──────────────────────────┴──────────────────────────────────────┐
│              Transport Abstraction (src/transport/)              │
│  ┌──────────────────────┐  or  ┌──────────────────────────────┐ │
│  │  Mock Transport      │      │ Tauri IPC Bridge (real)      │ │
│  │  (browser/test fb)   │      │  (ws_*/http_send/storage_*)  │ │
│  └──────────────────────┘      └──────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Tauri Commands / IPC
                           │ (real transport in the WebView2 app)
┌──────────────────────────┴──────────────────────────────────────┐
│              Rust Backend (src-tauri/src/)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  WS Engine (tokio-tungstenite, custom headers)          │   │
│  │  Reliability (auto-reconnect, heartbeat, RTT, TLS mode) │   │
│  │  HTTP Client (reqwest, rustls native roots)             │   │
│  │  Persistence (JSON store) + OS keychain secrets          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

The mock transport is now only a fallback for `vite dev` in a plain browser and for Vitest/jsdom; the real Tauri transport runs in the packaged WebView2 app.

## Data Flow: WebSocket Connection

### Phase 1 (Mock)

```
1. User clicks Connect → App calls transport.wsConnect(cfg)
2. Mock delays 600ms, emits:
   - Frame array: [{ dir: "sys", kind: "connect", body: "connected" }]
   - ConnStatus: { status: "connected", rttMs: 0 }
3. App's onFrame/onStatus callbacks fire → hooks update state (conns, frames)
4. Sidebar status dot turns blue; log shows "connected" system frame
5. Mock starts 1200ms tick loop emitting telemetry frames
```

### Phase 2+ (Real Rust)

```
1. User clicks Connect → App calls transport.wsConnect(cfg)
2. Tauri invokes ws_connect command (serialized ConnectConfig)
3. Rust creates a WebSocket, sets custom Authorization header, opens
4. Rust creates an ipc::Channel<ChannelMsg>, returns connId to JS
5. Rust spawns a tokio task that:
   - Reads frames from the WebSocket
   - Emits ChannelMsg::Frames (array of Frame) and ChannelMsg::Status
   - App's JS channel.onmessage = cb listener fires for each message
6. User sends a message → App calls transport.wsSend(connId, payload)
7. Tauri invokes ws_send(connId, payload) → Rust sends on the wire
```

**ChannelMsg contract** (Phase 2+):

```ts
enum ChannelMsg {
  Frames(Frame[]),      // 0+ frames emitted together
  Status(ConnStatus),   // Status change or heartbeat ack
  Error(reason, code)   // Connection error; reconnect scheduled
}
```

## Secret Resolution Pipeline

### In JavaScript (Never Full Resolve)

**`src/lib/resolve-env.ts`** with `{ skipSecret: true }`:

```
Input:  "Bearer {{token}}", env with token marked secret: true
↓ resolveEnv(input, env, { skipSecret: true })
Output: "Bearer {{token}}"  ← secret token left literal, never resolved
```

**Call sites:** All UI paths that might log or display:
- Connection log/history (Phase 5 shows templates, never resolved values)
- Settings panels (display `{{token}}` literal in headers preview)

### In Rust (Secret Get + Substitute) — Implemented

The outbound commands (`ws_connect`, `ws_send`, `http_send`) take `env_id` + `secret_keys`
and resolve `{{secretKey}}` tokens Rust-side, right on the way out (`storage/resolve.rs`):

```
1. ws_connect receives { config: { url, headers }, env_id, secret_keys }
2. Rust resolves {{token}} via the PRIVATE storage::secrets::get → OS keychain
3. Rust substitutes resolved values into the URL + header values, with per-context
   validation: CRLF rejected in headers, URL components percent-encoded
4. Rust sends the WS upgrade / HTTP request with actual secret values
5. The frame/history log keeps the **template** "Bearer {{token}}" (the `Outbound`
   envelope carries wire-vs-template separately); resolved secrets never get logged
6. Resolved secret values are also collected into ConnectConfig.redact (#[serde(skip)])
   so the supervisor scrubs them from any connect-error/reason string
```

**Security guarantees:**
- `secret_get` is NEVER registered as a Tauri command — resolution uses the private
  `storage::secrets::get`. The webview cannot read secrets back.
- Non-secret vars are resolved frontend-side; only secret tokens cross to Rust as keys.
- A secret resolved into a URL (not just a header) is also scrubbed from error strings.

## State Architecture

### Workspace Store (Coordinating)

**Single source of truth for cross-coupled state:**
- `collections[]` — folder tree + items (WS messages, HTTP requests)
- `conns: { [itemId]: ConnState }` — connection status + frame log (keyed by item, not connId)
- `urls: { [itemId]: string }` — parsed URL per item
- `msgs: { [collId]: SavedMessage[] }` — message payloads per collection
- `activeId` — currently selected item (WS or HTTP)
- `paused` — pause frame ingestion (suppresses telemetry/tick frames)
- `fmt` — active format (json/yaml/xml/text)
- `draft` — current composer content

**Atomic ops:**
- `connect(itemId)` → calls `transport.wsConnect()`, maps connId, watches status/frames
- `send(connId, payload)` → calls `transport.wsSend()`, logs out-frame
- `disconnect(connId)` → calls `transport.wsDisconnect()`
- `duplicateItem/Collection()` → creates new collections, items, conns, urls in one setState
- `addFrames(connId, frames[])` → appends frames, enforces MAX_FRAMES cap, filters pause state

**Refs (avoid stale closures):**
- `connIdMap` — maps itemId → currentConnId (connId changes on reconnect)
- `pausedRef` — transport callback reads this instead of stale `paused` prop
- `envRef` — env resolution in callbacks sees current active env

### Thin Hooks (Independent State)

- **`use-environments`** — `[envs[], activeEnv, setActiveEnv, upsertEnv, deleteEnv]` + re-export `resolveEnv`
- **`use-panels`** — sidebar/library widths, collapse, density (no persistence)
- **`use-tweaks`** — dark/accent/density, **persists to localStorage** (survive reload)

## Persistence Model (Implemented)

- **Collections/environments:** JSON files in the Tauri `app_data_dir`
  (`%APPDATA%/com.socketman.app/collections.json`, `environments.json`) via the Rust
  `storage/` module — atomic write (unique-tmp + fsync + rename), per-file async mutex,
  corrupt-tolerant load. localStorage (`relay.*` keys) survives only as a migration seed
  and as the mock-transport backing for browser dev.
- **Secrets:** OS keychain via the `keyring` 3.x crate (Windows → Credential Manager),
  service `SocketMan`. `secret_set`/`secret_delete` are commands; reads are the private
  `storage::secrets::get`. Plaintext secret values never touch disk; the env editor
  writes the value to the keychain and strips it from the persisted JSON.
- **History:** Rust-side append log (`history.json`) of TEMPLATE-form entries only,
  capped + serialized in `storage/history.rs`; read/cleared by the History panel.
- **Connections:** transient in-memory (not persisted).
- **Prefs:** localStorage (`relay.tweaks` — dark/accent/density).

## Export Seam (Track 1, Phase 2) — Implemented

### exportSave (Dialog + Rust Write)

The UI needs to save content (HTTP response, frame log) to the user's filesystem. The seam:

1. **Frontend calls** `transport.exportSave(suggestedName, filters, contentFor)` — opens a native **Save As** dialog with `suggestedName` + file type `filters`.
2. **User picks a path** — the dialog returns the path (or null if cancelled).
3. **Frontend calls** `contentFor(ext)` to generate the bytes for the chosen extension (e.g., `.json` vs `.txt` for frame log exports).
4. **Rust command** `export_write(path, contents)` writes the bytes to the user-picked path.

**No fs plugin, narrowest scope:** The only writable path is the one the user just selected. The `dialog:allow-save` capability is the _sole_ file-write permission.

**Security:** All exports carry TEMPLATES only (`{{token}}` never resolved, even in code-gen snippets).

**Implementation:**
- Real transport: Uses the `tauri_plugin_dialog` plugin (native file picker) + the new `export_write` Rust command.
- Mock transport (browser/Vitest): Falls back to a Blob download via the browser's save-as mechanism.

## Transport Contract (TypeScript ↔ Rust) — Implemented

### WebSocket

**Command: `ws_connect`** (JS → Tauri):
```ts
ws_connect(
  config: ConnectConfig,  // { url, headers, heartbeatSecs?, reconnect?, insecureTls? }
  env_id?: string,        // active env — Rust resolves {{secret}} in url/headers
  secret_keys?: string[], // which env vars are secret
  channel: ipc::Channel<ChannelMsg>  // Receiver for async frame/status/error emission
) -> Promise<connId: string>  // Unique ID for this connection (stable across reconnects)
```

**ChannelMsg stream** (Rust → JS, via `ipc::Channel.onmessage`):
```ts
ChannelMsg =
  | { t: "frames", batch: Frame[] }       // 0+ frames emitted together
  | { t: "status", status: ConnStatus }   // Status change (connecting/connected/disconnected/reconnecting)
  | { t: "error", message: string, code?: number }  // Unrecoverable error (logged as sys frame)
```

Frame shape:
```ts
{ id: u64, dir: "in"|"out"|"sys", kind: string, body: unknown, ts: u64, size: u64 }
```

ConnStatus shape:
```ts
{ connId: string, status: "disconnected"|"connecting"|"connected"|"reconnecting", 
  connectedAt?: u64, reason?: string, code?: u16, rttMs?: u64 }
```

**Command: `ws_disconnect`** (JS → Tauri):
```ts
ws_disconnect(connId: string) -> Promise<void>
```

**Command: `ws_send`** (JS → Tauri):
```ts
ws_send(connId: string, payload: string) -> Promise<void>
```

**Security:** Headers/URL may contain `{{token}}` secret literals; Rust substitutes real
values on the outbound path via the private `storage::secrets::get` (never a Tauri command),
and records the template form in the frame/history log.

**Also: `ws_send`** carries `env_id`/`secret_keys` too — the wire payload is secret-resolved
while the logged out-frame keeps the template.

### HTTP

**Outbound** (JS → Tauri):
```ts
http_send(
  req: { method, url, headers, body? },
  env_id?: string,        // active env — lets Rust resolve {{secret}} tokens
  secret_keys?: string[]  // which env vars are secret (resolved Rust-side)
) -> Promise<HttpResponse>

HttpResponse {
  status: number,
  statusText: string,
  headers: Record<string, string>,
  body: string,
  timingMs: number,
  sizeBytes: number
}
```

## Phase Roadmap (all complete)

### Core Phases (1–7)

| Phase | Deliverable | Status | Key Changes |
|-------|-------------|--------|------------|
| 1 | UI ported, mock transport | ✅ Done | React/TS scaffold, format gates (JSON gated), secret-skip resolver, mock server |
| 2 | Real Rust WS engine + IPC | ✅ Done | tokio-tungstenite, custom upgrade headers, ipc::Channel streaming, ChannelMsg enum |
| 3 | WS reliability | ✅ Done | Auto-reconnect + capped backoff, heartbeat ping/pong, RTT, dead-socket detection, self-signed TLS toggle |
| 4 | HTTP client | ✅ Done | reqwest (rustls native roots), real http_send, headers/body/status/timing, 16 MiB cap, HttpWorkspace |
| 5 | Persistence + secrets | ✅ Done | Atomic JSON store (collections/envs/history), OS keychain (keyring 3), Rust-side secret resolution |
| 6 | Rebrand + history | ✅ Done | Atomiton/Relay → SocketMan, neutral starter data, History panel over history.json |
| 7 | Windows packaging | ✅ Done* | NSIS + MSI installers, CSP build gate, icons, release build, deployment guide |

### Track 1: UX & Polish (5 phases)

| Phase | Deliverable | Status | Key Changes |
|-------|-------------|--------|------------|
| T1P1 | Notifications & keychain feedback | ✅ Done | Toast primitive, env-editor surfaces secretSet/secretDelete failures |
| T1P2 | Copy, Save, Export | ✅ Done | Dialog plugin + export_write command (IPC: 9→10), copy/save UI, code-gen (curl/fetch/wscat), templates-only exports |
| T1P3 | Search/filter + virtualization | ✅ Done | Log filter (direction + text search), @tanstack/react-virtual windowing, sticky-to-bottom |
| T1P4 | Code generation | ✅ Done | lib/codegen/ → curl/fetch/wscat snippets, copy-as-menu dropdown integration |
| T1P5 | Format fidelity | ✅ Done | js-yaml (JSON_SCHEMA, lossless for JSON objects) + fast-xml-parser, API unchanged |

\* Phase 7 code/build complete; the manual GUI install smoke test on a clean Windows
session is the one remaining acceptance item (cannot run headlessly). A WebDriver e2e
harness (`npm run e2e`) was added afterward to cover the real WebView2↔Rust IPC bridge.

## Reliability & Backoff (Implemented)

The connection is supervised by a **single Tokio task** running `select!` over the socket
read half, the command receiver, the heartbeat tick, the coalesce-flush tick, and a cancel
signal (`ws/connection.rs`). Keeping both socket halves in one task (no cross-task `.split()`)
avoids the rustls split read+write deadlock. The manager hoists the `(tx, rx)` channel and
the stable connId **above** any single socket (`ws/manager.rs`) so queued sends survive a
reconnect swap.

**Auto-reconnect (`ws/reconnect.rs`, `ws/backoff.rs`):**
- Capped exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, … (pure deterministic state
  machine; caller adds jitter). Cap is hardcoded, not user-configurable.
- On an unexpected drop: emit `reconnecting`, wait the backoff, reconnect on the hoisted
  channel + stable connId. `reset()` on a successful connect.
- Cancel arm (`ws/cancel.rs`): explicit user `disconnect` tears down INSTANTLY and never
  reconnects — whether idle-connected OR mid-backoff (a ~30-line `tokio::sync::Notify`
  token, since `tokio_util`'s CancellationToken isn't in the offline crate cache).

**Heartbeat (`ws/heartbeat.rs`):** an explicit `awaiting_pong` bit, not a naive timeout —
on each ping tick, if the previous pong never arrived the socket is declared dead →
reconnect; otherwise send a ping and set the bit. RTT is measured from the pong.

**Status kinds:**
- `disconnected` — not connected, not attempting
- `connecting` — actively opening
- `connected` — open, heartbeat healthy
- `reconnecting` — backoff delay active, waiting to retry

## TLS & Insecure Mode (Implemented — `ws/tls.rs`)

Two per-connection modes:
- **SecureNativeRoots (default):** `connect_async` with the rustls native-roots config
  (the Windows cert store) — full cert-chain, expiry, and hostname checks.
- **InsecureNoVerification (opt-in `insecureTls`):** a custom verifier accepting ANY cert
  and ANY hostname. This is FULL MITM exposure (not merely "accept self-signed") — named
  honestly because it is a footgun. Default OFF; opt-in per connection with a visible
  warning. An in-test `wss://` proof exercises both paths.

The same rustls/aws-lc-rs + platform-verifier provider backs both the WS verifier and the
reqwest HTTP client — one TLS story, native roots, no native-tls.

## Code Quality Gates

- **TypeScript strict:** All source files compile without errors or warnings.
- **Format round-trip:** JSON gated (no exceptions); YAML/XML documented lossy subset.
- **Secret resolution:** `skipSecret: true` asserted to leave tokens literal (belt-and-suspenders tests).
- **CSP:** `script-src 'self'` verified (CI gate via `assert-csp.mjs`) — no `unsafe-eval` or `unsafe-inline`.
- **App boot:** Smoke test verifies full tree renders through mock transport without crashing.
- **Build:** `npm run build` + `cargo build` both succeed.

## Known Limitations (v1)

- **No Postman import:** Own JSON format only (import deferred if customer request).
- **No binary WS frames:** Text-only (binary is out of scope).
- **No SSE/Socket.IO/MQTT:** WS + HTTP only.
- **No macOS/Linux:** Windows-first (keyring uses `windows-native`; packaging is NSIS/MSI). Cross-platform deferred.
- **No custom cert pinning:** per-connection insecure toggle only; pinning deferred.
- **XML lossy:** Single-element arrays collapse, numeric strings coerce. JSON and YAML are the lossless formats (YAML lossless for JSON-object payloads).

---

## Developer Workflow (Phase 2+)

### Adding a New Tauri Command

1. Add the thin handler in `src-tauri/src/commands.rs` with `#[tauri::command]` (real work
   lives in `ws::manager`, `http::client`, or `storage::*`).
2. Append it to the `generate_handler![]` list in `lib.rs` (alphabetized, one per line).
3. Update the `Transport` interface in `src/transport/transport.ts`.
4. Mirror it in `src/transport/tauri-transport.ts` (real) and `mock-transport.ts` (fallback).
5. Invoke via `transport` in React hooks.

Current registered commands (`lib.rs`, alphabetized, 10 total): `export_write`, `history_append`, `http_send`, `secret_delete`, `secret_set`, `storage_load`, `storage_save`, `ws_connect`, `ws_disconnect`, `ws_send`. `secret_get` is deliberately absent.

### Testing Workflow

- **Unit:** Vitest + `@testing-library/react` for components/hooks (38 tests).
- **Format:** Round-trip serialize/parse (JSON gated lossless, YAML/XML documented lossy).
- **Integration:** App-boot smoke test through the mock transport; Rust integration tests
  (57 green) cover WS upgrade/echo/reconnect/TLS, HTTP, keychain round-trip, storage no-leak.
- **E2E (`npm run e2e`):** `tauri-driver` (WebDriver over real WebView2) drives the built
  release app against a hermetic local echo server (`e2e/`). The only layer that catches
  JS↔Rust IPC/Channel protocol skew.

### Security Checklist

- [ ] No secrets hardcoded in React source.
- [ ] `resolveEnv(..., { skipSecret: true })` used in all send/connect/HTTP paths.
- [ ] Only secret KEYS (`env_id` + `secret_keys`) cross to Rust; values resolved Rust-side.
- [ ] `secret_get` never registered as a Tauri command.
- [ ] Frame/history logs keep templates (resolved secrets never logged; URL secrets scrubbed
      from error strings).
- [ ] CSP tight: `script-src 'self'` with no `unsafe-eval` (gated by `npm run build`).
