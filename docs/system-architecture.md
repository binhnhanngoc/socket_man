# SocketMan System Architecture

**Overview:** A Tauri 2 desktop app bridging React/TypeScript UI with a Rust transport backend. Phase 1 complete with mock transport; real WS/HTTP IPC landing Phase 2+.

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
│  │  Mock Transport      │      │ Tauri IPC Bridge (Phase 2+)  │ │
│  │  (Phase 1)           │      │  (ws_* + http_send commands) │ │
│  └──────────────────────┘      └──────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Tauri Commands / IPC
                           │ (Phase 2+ only)
┌──────────────────────────┴──────────────────────────────────────┐
│              Rust Backend (src-tauri/src/)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  WS Engine (tokio-tungstenite, custom headers)          │   │
│  │  HTTP Client (reqwest)                                   │   │
│  │  Reliability (auto-reconnect, heartbeat, RTT)           │   │
│  │  Persistence (JSON store, OS keychain secrets)          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

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

### In Rust (Secret Get + Substitute)

**Phase 5 only** (not yet built):

```
1. ws_connect command receives { url, headers: { "Authorization": "Bearer {{token}}" } }
2. Rust resolves {{token}} by calling secret_get("token") → OS keychain
3. Rust substitutes resolved value into header
4. Rust sends WS upgrade with actual token
5. Frame logged in Rust contains the **template** "Bearer {{token}}", not resolved value
6. When history shown to user, JS renders the template (no secrets in JS heap)
```

**Security guarantee:** `secret_get` is NEVER registered as a Tauri command — it is a private Rust function. The webview cannot call it directly.

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

## Persistence Model

### Phase 1 (Current)

- **Collections/messages/URLs:** localStorage (key `relay.collections`, `relay.msgCollNames`, migrations from old keys)
- **Prefs:** localStorage (`relay.tweaks` — dark/accent/density)
- **Connections:** transient in-memory (not persisted)
- **Secrets:** not yet (no OS keychain integration)

### Phase 5+ (Planned)

- **Collections/messages/envs:** JSON files in `%APPDATA%/SocketMan/` (SQLite optional)
- **Secrets:** OS keychain (`keyring` crate on Windows → Credential Manager)
- **Prefs:** localStorage (no change)
- **History:** Rust-side append log (never loaded into JS state)

## Transport Contract (TypeScript ↔ Rust)

### WebSocket

**Outbound** (JS → Tauri command):
```ts
ws_connect(
  url: string,
  headers: Record<string, string>,  // includes Authorization
  onFrame: (frames: Frame[]) => void,
  onStatus: (status: ConnStatus) => void
) -> Promise<connId: string>
```

**Inbound** (Rust → JS, via `ipc::Channel`):
```ts
ChannelMsg::Frames(Frame[])    // Array of { id, dir, kind, body, ts, size }
ChannelMsg::Status(ConnStatus) // { connId, status, connectedAt?, reason?, code?, rttMs? }
ChannelMsg::Error(reason)      // Unrecoverable error; manual reconnect required
```

**Disconnect:**
```ts
ws_disconnect(connId: string) -> Promise<void>
```

**Send:**
```ts
ws_send(connId: string, payload: string) -> Promise<void>
```

### HTTP

**Outbound** (JS → Tauri):
```ts
http_send(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string
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

## Phase Roadmap

| Phase | Deliverable | Status | Key Changes |
|-------|-------------|--------|------------|
| 1 | UI ported, mock transport | ✅ Done | React/TS scaffold, format gates (JSON gated), secret-skip resolver, mock server |
| 2 | Real Rust WS engine + IPC | Pending | tokio-tungstenite, custom upgrade headers, ipc::Channel streaming, ChannelMsg enum |
| 3 | WS reliability | Pending | Auto-reconnect + capped backoff, heartbeat ping/pong, RTT measurement, dead-socket detection |
| 4 | HTTP client | Pending | reqwest, real http_send command, headers/body/status/timing, wired HttpWorkspace |
| 5 | Persistence + secrets | Pending | JSON store (collections/envs/history), OS keychain (secret resolution Rust-side), history panel |
| 6 | Rebrand + history | Pending | SocketMan branding (replace Atomiton), starter data, history panel UI |
| 7 | Windows packaging | Pending | NSIS/MSI installer, signed optional, icons, release build |

## Reliability & Backoff (Phase 3+, Not Yet Built)

**Auto-reconnect strategy:**
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, ..., capped at 60s (hardcoded, not user-configurable per F18).
- Single-task select loop: one Tokio task manages connection + reconnect state (single source of truth for connId).
- Cancel arm: user `disconnect` stops reconnect loop (never auto-reconnect after explicit disconnect).
- Heartbeat: send ping every 30s (hardcoded). If no pong within 5s, declare socket dead → reconnect.

**Status kinds:**
- `disconnected` — not connected, not attempting
- `connecting` — actively opening
- `connected` — open, heartbeat healthy
- `reconnecting` — backoff delay active, waiting to retry

## TLS & Insecure Mode (Phase 1 UI, Phase 3 Honor)

**Phase 1:** ConnectConfig carries no TLS fields. UI doesn't show toggle yet.

**Phase 3+:** Optional `insecureTls` boolean in ConnectConfig (defaults false).
- When `true`: Disables **all** cert + hostname verification (true MITM risk).
- Warning shown at connect time + persisted as a per-connection flag (not a silent default).
- Phase 1 keeps it strict (rustls + native-roots = Windows cert store).

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
- **No macOS/Linux:** Windows-first (cross-platform Phase 7).
- **No custom cert pinning:** Phase 3 adds per-connection insecure toggle; pinning deferred.
- **YAML/XML lossy:** Single-element arrays collapse, numeric strings coerce. JSON is the lossless format.

---

## Developer Workflow (Phase 2+)

### Adding a New Tauri Command

1. Define the Rust fn in `src-tauri/src/{ws,http}/mod.rs`.
2. Add `#[tauri::command]` macro.
3. Append to the `generate_handler![]` list in `lib.rs` (alphabetized).
4. Update `src/transport/transport.ts` interface.
5. Update mock (if testing) or skip for integration testing (real Rust).
6. Invoke via `transport` in React hooks.

### Testing Workflow

- **Unit:** Vitest + `@testing-library/react` for components/hooks.
- **Format:** Test round-trip serialize/parse (JSON gated, YAML/XML documented lossy).
- **Integration:** Smoke test App boot through mock/real transport.
- **E2E:** Manual testing with dev server + real WebSocket (Phase 2+).

### Security Checklist

- [ ] No secrets hardcoded in React source.
- [ ] `resolveEnv(..., { skipSecret: true })` used in all send/connect/HTTP paths.
- [ ] `secret_get` never registered as a Tauri command.
- [ ] Frame/history logs assembled Rust-side (never resolved secrets logged).
- [ ] CSP tight: `script-src 'self'` with no `unsafe-eval`.
