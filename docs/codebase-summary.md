# SocketMan Codebase Summary

**Status:** Phase 1 (UI + mock transport) ✅ complete. Phase 2 (Rust WS engine + IPC) ✅ complete. Phase 3 (reliability: reconnect + heartbeat) pending.

## Directory Structure

```
socket_man/
├── src/                            # React/TypeScript frontend
│   ├── main.tsx, App.tsx           # Vite entry + top-level layout
│   ├── types.ts                    # Domain types (Collection, Item, Message, Env, Frame, ConnStatus)
│   ├── transport/
│   │   ├── transport.ts            # Transport interface + type definitions (IPC contract mirror)
│   │   ├── mock-transport.ts       # Mock server (simulates WS+HTTP, Phase 1 only)
│   │   └── index.ts                # Selects mock now; swaps real Tauri/Rust impl in Phase 2
│   ├── hooks/
│   │   ├── use-workspace-store.ts  # Coordinating store (collections, conns, messages, cross-state ops)
│   │   ├── use-environments.ts     # Environment CRUD + resolveEnv re-export
│   │   ├── use-panels.ts           # Sidebar/library widths, collapse, density UI state
│   │   └── use-tweaks.ts           # Dark mode, accent, density (persists to localStorage)
│   ├── lib/
│   │   ├── util.ts                 # byteSize, fmtTime, fmtDur, prettyJSON, compactJSON
│   │   ├── resolve-env.ts          # SECURITY: secret-skipping env var resolution ({{key}} tokens)
│   │   └── editable-name.tsx       # Inline name editor component
│   ├── components/
│   │   ├── top-nav.tsx, collections-sidebar.tsx, message-library.tsx
│   │   ├── ws-workspace.tsx, http-workspace.tsx
│   │   ├── connection-bar.tsx, log-stream.tsx, log-row.tsx, composer.tsx
│   │   ├── ws-tab-panes.tsx        # Headers/Auth/Settings UI (minimal in P1, extended P3)
│   │   ├── env-menu.tsx, env-editor.tsx
│   │   ├── tweaks-panel.tsx, resizer.tsx
│   │   ├── icons.tsx, theme-provider.tsx
│   │   └── format-view.tsx, json-view.tsx
│   ├── formats/
│   │   ├── serialize.ts            # serialize(obj, fmt) + parseFmt(str, fmt) dispatch
│   │   ├── yaml.ts, xml.ts         # Hand-rolled YAML/XML (view-only, lossy)
│   │   └── __tests__/
│   │       └── format-round-trip.test.ts (29+ tests, JSON gated lossless, YAML/XML documented lossy)
│   ├── data/starter-data.ts        # COLLECTIONS, MESSAGES, ENVIRONMENTS (Atomiton branding, rebrand Phase 6)
│   ├── styles/
│   │   ├── app.css, colors_and_type.css (verbatim from design/)
│   │   └── tweaks-panel-style.ts
│   └── __tests__/
│       ├── use-environments.test.ts (9 tests: secret-skip F1, env resolution)
│       ├── app-smoke.test.tsx       (4 tests: App boot, tweaks panel, WS state)
│       └── test-setup.ts
├── src-tauri/                      # Rust backend (Phase 2 WS engine implemented)
│   ├── src/
│   │   ├── main.rs                 # Windows subsystem wrapper (console-free)
│   │   ├── lib.rs                  # Tauri entrypoint + WsManager state + command registry
│   │   ├── error.rs                # AppError enum + Serialize-to-string for IPC
│   │   ├── commands.rs             # Thin handlers: ws_connect/disconnect/send (alphabetized)
│   │   └── ws/
│   │       ├── mod.rs              # (module definition)
│   │       ├── types.rs            # ConnectConfig, Frame, ConnStatus, ChannelMsg, ConnId type
│   │       ├── request.rs          # build_request — custom headers on WS upgrade
│   │       ├── manager.rs          # WsManager — atomic connId counter + connection map
│   │       └── connection.rs       # Single-task tokio::select! loop over socket halves
│   ├── tests/
│   │   ├── ws_integration.rs       # Authorization on upgrade, echo, status flow, reconnect stable, TLS proof
│   │   └── tls/mod.rs              # In-test TLS server helper (rustls + tokio-rustls)
│   ├── Cargo.toml                  # tokio, tokio-tungstenite 0.29 (rustls-tls-native-roots), futures-util, dev-deps
│   ├── Cargo.lock                  # Committed for reproducibility
│   ├── tauri.conf.json             # Window config, production CSP (tight, no unsafe-eval)
│   └── icons/
├── design/                         # Reference prototype (read-only after Phase 1)
│   ├── Relay.html, app.jsx, formats.jsx, data.js, app.css, colors_and_type.css
│   └── (Atomiton branding — visual truth for parity checks)
├── plans/260602-1457-socketman-tauri-rust-workbench/
│   ├── plan.md, phase-01-scaffold-ui-port.md, phase-02-*.md, ...
│   └── reports/
├── index.html, package.json, vite.config.ts, tsconfig.json, vitest.config.ts
└── scripts/assert-csp.mjs          # CI gate: verifies CSP has no unsafe-eval in script-src
```

## Key Modules & Responsibilities

### Transport Layer (The Seam) — Phase 2 Shipped

**`src/transport/transport.ts`** — Stable interface (TS/Rust mirror):

```ts
interface Transport {
  wsConnect(cfg: ConnectConfig, onFrame, onStatus): Promise<connId>;
  wsSend(connId, payload): Promise<void>;
  wsDisconnect(connId): Promise<void>;
  httpSend(req: HttpRequest): Promise<HttpResponse>;  // Pending Phase 4
}
```

**`src/transport/index.ts`** — Runtime selector:
- `__TAURI_INTERNALS__` present (in Tauri webview) → use `tauriTransport`
- `VITE_TRANSPORT` env flag can force `mock` or `tauri` explicitly
- Fallback: mock (for Vitest/jsdom/plain browser dev)

**`src/transport/tauri-transport.ts`** — Phase 2 real transport (NEW):
- `wsConnect(cfg, onFrame, onStatus)` → `invoke("ws_connect", { config: cfg, channel })` with fresh `ipc::Channel<ChannelMsg>`
- `channel.onmessage = cb` setter (not awaitable method) receives streamed frames/status/errors
- Errors surfaced as sys frames so they appear in the live log
- `httpSend()` rejects with "implemented in Phase 4"

**`src/transport/mock-transport.ts`** — Phase 1 mock (unchanged):
- 600ms connect latency, echo replies, tick-frame telemetry
- Unchanged in Phase 2; acts as fallback for `vite dev` in browser

**`ConnectConfig`** — Phase 1 minimal: `{ url: string, headers: Record<string, string> }`. Reliability fields (reconnect, insecureTls) TBD Phase 3.

### State Management (Coordinating Store) — Phase 2 Enhanced

**`src/hooks/use-workspace-store.ts`** (305 LOC — exceeds 200-line target intentionally):
- **Why one store:** Prototype `App()` cross-couples item/connection/message state. Ops like `duplicate` mutate urls + conns + msgs atomically. Splitting forces circular imports → worse coupling.
- **Owns:** Collections, connections (url map, frame log, status), messages (saved payloads), **connMeta** (per-item headers/auth), active item/format/draft, pause state.
- **connMeta** (NEW Phase 2): `Record<itemId, ConnMeta>` where ConnMeta = `{ headers: HeaderRow[], authType: "none"|"bearer", authToken: string }`.
  - `freshMeta()` creates default (empty headers, no auth).
  - `composeHeaders(meta, env)` merges header rows + optional `Authorization: Bearer {{token}}` into the `headers: Record<string, string>` sent to `ws_connect`.
- **Exposes:** `connect(itemId)`, `send(connId, payload)`, `disconnect(connId)`, `addFrames()`, `duplicateItem/Collection()`, `updateMeta(itemId, patch)`, name editors.
- **Refs:** Uses `useRef` to avoid stale closures in transport callbacks (transport runs async, state updates are sync). `metaRef` prevents stale meta in callbacks.

**Thin hooks:**
- `use-environments.ts` — env CRUD, active env, re-exports `resolveEnv` pure function.
- `use-panels.ts` — sidebar/library widths, collapse, density (UI prefs, no persistence needed here).
- `use-tweaks.ts` — dark/accent/density, **persists to localStorage** (rewrote from host `postMessage` protocol — no host in Tauri).

### Secret Resolution (Security-Critical)

**`src/lib/resolve-env.ts`** — Pure function (no React):

```ts
resolveEnv(str, env, { skipSecret: true })
```

- **Without `skipSecret`:** Resolves `{{key}}` → env var value for all keys (debug/preview).
- **With `skipSecret:true`:** Leaves `{{secret-key}}` as literal text (never enters JS heap).
- **Call sites:** All send/connect/HTTP paths call with `skipSecret:true`. Secret tokens are substituted **Rust-side** at wire time (Phase 5).
- **Why:** Prevents secret values from leaking into the JS heap; the browser has no OS keychain, so secrets must stay Rust-private until sent.

**Tests:** 9 vitest tests in `use-environments.test.ts` — specifically assert that `skipSecret` leaves secret tokens literal and does NOT resolve them.

### Format System (Gated Lossless)

**`src/formats/serialize.ts`** — Dispatch layer:
- `serialize(obj, format: "json"|"yaml"|"xml"|"text")` → string
- `parseFmt(str, format)` → object

**Format implementations:**
- **JSON:** Native `JSON.stringify`/`parse`. No loss.
- **YAML/XML:** Hand-rolled parsers (from prototype). Single-element arrays → strings, numeric strings → numbers. **View-only, best-effort.**

**Tests (13 format tests):**
- **JSON round-trip (gated):** 7 samples must pass losslessly (no exceptions). A green test suite means JSON works perfectly.
- **YAML/XML (documented subset):** Test only the lossless cases. Known limitations (array-of-arrays, multi-doc YAML, numeric coercion) are **documented in the test file**, not hidden as xfail — v1 scope per plan.

### Components (UI Port) — Phase 2 Enhanced

All `.jsx` from `design/` ported to `.tsx`:
- **Top nav:** Theme/density/env switcher.
- **Sidebar:** Collections tree, item list, nested rename/duplicate.
- **Message library:** Saved payloads per collection.
- **WS workspace:** Connection bar (connect/disconnect, status), live log stream with pause, composer, format tabs (JSON/YAML/XML/Text).
- **WS tab panes** (NEW Phase 2, `ws-tab-panes.tsx`):
  - **Headers pane:** Editable rows (k/v pairs) sent as custom headers on WS upgrade. Add/remove rows, empty state.
  - **Auth pane:** Type selector (None/Bearer token). Bearer input accepts literals or `{{token}}` templates (resolved Phase 5).
  - **Settings pane:** Display-only in Phase 2; reliability defaults (ping/backoff) bound Phase 3.
- **HTTP workspace:** Method/URL/headers form, response viewer (command rejects "Phase 4").
- **Env menu/editor:** Active env display, manage vars (plaintext + secret flags).
- **Tweaks panel:** Dark mode toggle, accent color, density (compact/normal/spacious).
- **Resizer:** Draggable sidebar/library width.

**No inline styles** (CSS classes only). **No `window.*` globals** — all imports clean.

## Testing

- **Test files:** 4 suites, 29 tests (all passing).
  - `format-round-trip.test.ts` — 15 format tests (JSON + YAML/XML + text).
  - `use-environments.test.ts` — 9 env resolution tests (secret-skip security).
  - `app-smoke.test.tsx` — 5 App boot smoke tests.
- **CI gates:**
  - TypeScript strict compile.
  - Vitest 29/29 passing.
  - CSP assertion (`scripts/assert-csp.mjs`) — verifies `script-src 'self'` has no `unsafe-eval` or `unsafe-inline`.

## Security Model (Phase 1)

1. **Secrets stay Rust-private:** Secret var tokens (`{{token}}`) are skipped in JS; only Rust resolves them at send time (Phase 5).
2. **Tight CSP:** No `unsafe-eval`, no `unsafe-inline` in `script-src`. Vite+ESM eliminates the need for Babel CDN eval.
3. **IPC surface:** Phase 1 has zero commands. Phase 2+ whitelist only the commands that exist (ws_connect, ws_send, ws_disconnect, http_send).
4. **No secret_get command:** The resolver is Rust-internal, never exposed to the webview (critical plan F3).

## Phase 2 Implementation Details (Complete)

**Rust backend (`src-tauri/src/`):**
- **`error.rs`:** `AppError` enum (InvalidUrl, Connect, UnknownConn, Send) using `thiserror`. Serializes to plain string for Tauri IPC error handling.
- **`commands.rs`:** Three thin handlers (alphabetized in registry):
  - `ws_connect(config, channel, manager)` → invokes `manager.connect()`, returns connId.
  - `ws_disconnect(connId, manager)` → invokes `manager.disconnect()`.
  - `ws_send(connId, payload, manager)` → invokes `manager.send()`.
  - Note: `secret_get()` intentionally NOT registered; kept Rust-private (Phase 5).
- **`lib.rs`:** Tauri entrypoint. Manages `WsManager` state + command registry. On window-destroy: calls `shutdown_all()` (drops all connection senders, tasks exit).
- **`ws/types.rs`:** IPC contract mirror:
  - `ConnectConfig` (url + headers as BTreeMap). Debug impl masks sensitive header values (Authorization/Cookie/Proxy-Authorization) → "***".
  - `Frame`, `ConnStatus`, `ConnStatusKind`, `FrameDir`, `ConnId` type, `ChannelMsg` enum (#[serde] tagged "t" field, camelCase rename).
  - Helper fn `is_sensitive_header()` checks for redacting.
- **`ws/request.rs`:** `build_request()` creates tungstenite ClientRequestBuilder with custom headers (incl. Authorization). Validates URL is ws:// or wss:// only.
- **`ws/manager.rs`:** `WsManager` holds atomic `conn_id_counter` + `connections: DashMap<ConnId, Sender<...>>`. Exposes `connect()`, `send()`, `disconnect()`, `shutdown_all()` with error scrubbing (strips known secret headers from emitted errors).
- **`ws/connection.rs`:** Single-task loop running `tokio::select!` over:
  - Incoming WS frames (split stream read half) → emits `ChannelMsg::Frames`.
  - Outgoing frame commands (mpsc Receiver) → sends to WS.
  - Task-local reconnect state (Phase 3 will add backoff, heartbeat).

**Frontend updates (`src/`)**:
- **`types.ts`:** New `ConnMeta`, `HeaderRow`, `AuthType` types.
- **`transport/tauri-transport.ts`:** Real transport calling `invoke("ws_connect", ...)` with ipc Channel. Handles frame/status/error routing.
- **`hooks/use-workspace-store.ts`:** Added `connMeta` state + `updateMeta()` + `composeHeaders()` fn merging headers + auth token into ConnectConfig.
- **`components/ws-tab-panes.tsx`:** `HeadersPane`, `AuthPane` (new); editable, composed into headers at connect time.

**Testing:**
- `src-tauri/tests/ws_integration.rs` + `tls/mod.rs`: Authorization on upgrade, echo, status flow, reconnect ID stable, queued-send survives swap, conn-map no memory leaks, secret redaction, wss:// proof.

## Next: Phase 3 (Reliability & Heartbeat)

- **Auto-reconnect:** Exponential backoff (1s, 2s, ..., 60s), single-task select! manages state (single source of truth for connId).
- **Heartbeat:** 30s ping interval, 5s pong timeout → dead-socket detection.
- **Status kinds:** `connecting`, `connected`, `reconnecting` added; `disconnected` for explicit user disconnect.
- **Settings pane:** Bind reliabilty UI (ping interval, backoff cap) to per-connection config sent to Rust.

---

## Size & Metrics

- **Frontend:** ~17 .ts/.tsx files, 200-line modular target (workspace store 305 LOC exceeds with rationale).
- **Rust:** lib.rs minimal (near-empty in Phase 1).
- **CSS:** 1500+ lines (verbatim from design/).
- **Tests:** 29 passing, TDD gates on format round-trip + env resolution + smoke.
- **Bundle:** ~2.5 MB (Tauri + React runtime + bundled assets).

---

## Constraints & Limitations (Phase 2 Snapshot)

- **Reliability:** No auto-reconnect, heartbeat, or RTT yet (lands Phase 3).
- **Secrets:** Plaintext in localStorage (Phase 5 moves to OS keychain + Rust resolution).
- **Persistence:** localStorage only (Phase 5 moves collections/envs to JSON files + append-only history).
- **HTTP:** Stubbed; reqwest client lands Phase 4.
- **YAML/XML:** Best-effort (view-only); numeric coercion, single-element collapse; JSON is the lossless path.
- **Platform:** Windows-first (WebView2 preinstalled). Cross-platform build deferred Phase 7.
- **TLS:** rustls + native-roots (strict in Phase 2). Insecure toggle lands Phase 3.
