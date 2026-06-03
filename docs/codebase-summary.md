# SocketMan Codebase Summary

**Status:** Phases 1–7 ✅ complete (core); v2 Track 1 (UX & Polish) ✅ complete — 5 new phases (toast notifications, copy/save/export, search/filter + virtualization, code-gen, format fidelity). Installers: MSI (6.1 MB) + NSIS setup.exe (3.9 MB). WebDriver e2e harness (`npm run e2e`) catches JS↔Rust IPC protocol skew. Rust: 57 tests green; Frontend: 85 Vitest green (was 38, +47 for new features); tsc clean; CSP gate green.

SocketMan is a Tauri 2 desktop **WebSocket/HTTP workbench**: a React/TypeScript UI over a Rust transport backend. The whole reason for a Rust backend is capabilities the browser can't reach — custom WS upgrade headers, OS keychain, native-roots TLS, a strict HTTP client.

## What shipped (per phase)

### Core (Phases 1–7)

- **P1 UI + mock transport.** React/TS scaffold ported from the `design/` prototype; format system (JSON gated lossless, YAML/XML view-only); secret-skipping env resolver; mock server for browser/test runs.
- **P2 Real WS engine + IPC.** `tokio-tungstenite`, custom upgrade headers, `ipc::Channel<ChannelMsg>` streaming (frames/status/error), stable connId.
- **P3 WS reliability.** Single-task `select!` connection loop, auto-reconnect with capped exponential backoff (1→30s) + jitter, explicit-`awaiting_pong` heartbeat → dead-socket detection + RTT, instant cancel on user disconnect, per-connection self-signed TLS toggle.
- **P4 HTTP client.** `reqwest` 0.13.4 with `rustls` + `rustls-platform-verifier` (Windows cert store — same provider as the WS verifier). `http_send` → status/headers/body/timing, 16 MiB body cap, URL-stripped error mapping. Frontend `use-http` hook + `HttpWorkspace` (request-editor / response-view split).
- **P5 Persistence & secrets.** Rust `storage/`: atomic JSON store (unique-tmp + fsync + rename, per-file async mutex, corrupt-tolerant load); OS keychain via **keyring 3** (`secret_set`/`secret_delete` commands; `secret_get` is a PRIVATE fn, never a command); private `resolve_secrets` resolves `{{secret}}` Rust-side on the outbound path with per-context validation (CRLF-in-header rejected, URL components percent-encoded); URL-resolved secrets scrubbed from error strings. Frontend persists collections/environments to the JSON store (localStorage = migration seed + mock backing); env editor writes secrets to the keychain and strips plaintext.
- **P6 Rebrand & history.** Atomiton/Relay → SocketMan (only `relay.*` localStorage migration keys remain); neutral starter data (`wss://echo.websocket.events`, `https://postman-echo.com`, placeholder secret); History panel reads/clears persisted `history.json` (templates only, appended Rust-side).
- **P7 Packaging.** `tauri.conf.json` bundle metadata (publisher/category/copyright/descriptions, NSIS currentUser), CSP gate wired into `npm run build`, full icon set, `docs/deployment-guide.md`.

### Track 1: UX & Polish (5 phases)

- **T1P1 Notifications & keychain feedback.** Module-singleton toast store (`use-toasts.ts`) + `toast-host.tsx` root mount. `env-editor` surfaces `secretSet`/`secretDelete` failures via error toast (no more silent swallow); keychain errors now visible to the user.
- **T1P2 Copy, Save, Export.** Native dialog plugin (`tauri_plugin_dialog`) + new Rust command `export_write(path, contents)` (IPC allowlist: 9→10). `export-file.ts` exports (copy/save) HTTP response bodies and WS frame logs; frame log exports offer both `.json` (structured) and `.txt` (readable); all exports are TEMPLATES only (`{{token}}` never resolved). "Copy as ▾" dropdowns in HTTP workspace + WS Headers pane offer curl/fetch/wscat code-gen. No fs plugin; `dialog:allow-save` capability only.
- **T1P3 Search/filter + virtualization.** `use-log-filter.ts` + `log-filter-bar.tsx` filters WS frame log by direction set + free-text search with match count. `log-stream.tsx` virtualizes via `@tanstack/react-virtual` (sticky-to-bottom preserved). Replaces old all/sent/recv toggle.
- **T1P4 Code generation.** `lib/codegen/` (to-curl.ts, to-fetch.ts, to-wscat.ts, escaping.ts) generates curl/fetch/wscat snippets from HTTP requests and WS connections. Snippets skip secret resolution (emit templates). Wired into "Copy as ▾" dropdowns.
- **T1P5 Format fidelity.** Swap hand-rolled YAML/XML for `js-yaml` (JSON_SCHEMA) + `fast-xml-parser`. **YAML is now LOSSLESS for JSON-object payloads** (was "view-only best-effort"). XML remains best-effort (data-model losses asserted honestly). `serialize`/`parseFmt` API unchanged; public adoption unchanged.

## Directory Structure

```
socket_man/
├── src/                            # React/TypeScript frontend (~5.8k LOC .ts/.tsx, +47 tests)
│   ├── main.tsx, App.tsx           # Vite entry + top-level layout
│   ├── types.ts                    # Domain types (Collection, Item, Message, Env, Frame, ConnStatus, ConnMeta)
│   ├── transport/
│   │   ├── transport.ts            # Transport interface + types + exportSave (IPC contract mirror)
│   │   ├── tauri-transport.ts      # Real transport — invoke() + ipc::Channel routing
│   │   ├── mock-transport.ts       # Mock server (WS+HTTP) — browser/Vitest fallback only
│   │   ├── mock-server-simulation.ts  # Echo/telemetry simulation for the mock
│   │   └── index.ts                # Runtime selector (Tauri webview → real; else mock)
│   ├── hooks/
│   │   ├── use-workspace-store.ts  # Coordinating store (collections, conns, messages, connMeta)
│   │   ├── use-environments.ts     # Environment CRUD + resolveEnv re-export + keychain writes
│   │   ├── use-http.ts             # HTTP request/response hook (drives http_send)
│   │   ├── use-history.ts          # History panel state over persisted history.json
│   │   ├── use-toasts.ts           # Toast notifications (module-singleton store)
│   │   ├── use-log-filter.ts       # Frame log search + filter (direction, text, match count)
│   │   ├── use-panels.ts           # Sidebar/library widths, collapse, density UI state
│   │   └── use-tweaks.ts           # Dark/accent/density (persists to localStorage)
│   ├── lib/
│   │   ├── util.ts                 # byteSize, fmtTime, fmtDur, prettyJSON, compactJSON
│   │   ├── resolve-env.ts          # SECURITY: secret-skipping env var resolution ({{key}})
│   │   ├── secret-refs.ts          # Builds {envId, secretKeys} passed to Rust on outbound
│   │   ├── history-log.ts          # Template-form history entry construction
│   │   ├── export-file.ts          # copyText, saveText, saveFrameLog (copy/save UI helpers)
│   │   ├── codegen/                # Code-gen module: to-curl.ts, to-fetch.ts, to-wscat.ts, escaping.ts
│   │   └── editable-name.tsx       # Inline name editor component
│   ├── components/
│   │   ├── top-nav.tsx, collections-sidebar.tsx, message-library.tsx, message-card.tsx
│   │   ├── ws-workspace.tsx, ws-tab-panes.tsx, copy-as-menu.tsx  # WS log + code-gen "Copy as ▾" dropdown
│   │   ├── http-workspace.tsx, http-request-editor.tsx, http-response-view.tsx
│   │   ├── connection-bar.tsx, log-stream.tsx, log-row.tsx, log-filter-bar.tsx, composer.tsx
│   │   ├── history-panel.tsx                            # reads/clears persisted history
│   │   ├── env-menu.tsx, env-editor.tsx, toast-host.tsx  # Toast root mount point
│   │   ├── tweaks-panel.tsx, tweaks-panel-style.ts, tweak-controls.tsx, resizer.tsx
│   │   └── icons.tsx
│   ├── formats/
│   │   ├── serialize.ts            # serialize(obj, fmt) + parseFmt(str, fmt) dispatch
│   │   ├── yaml.ts, xml.ts         # js-yaml (JSON_SCHEMA, lossless for JSON objects) + fast-xml-parser
│   │   ├── format-view.tsx, json-view.tsx
│   │   └── format-round-trip.test.ts  # JSON gated lossless, YAML lossless for JSON objects, XML documented lossy
│   ├── data/starter-data.ts        # COLLECTIONS, MESSAGES, ENVIRONMENTS (neutral SocketMan starter data)
│   ├── styles/app.css, colors_and_type.css   # verbatim from design/
│   ├── *.test.ts(x)                # co-located: use-environments, use-history, use-http, use-log-filter, secret-refs, app-smoke, export-file, codegen, format round-trip
│   └── test-setup.ts
├── src-tauri/                      # Rust backend (~2.3k LOC, all phases + export_write)
│   ├── src/
│   │   ├── main.rs                 # Windows subsystem wrapper (console-free)
│   │   ├── lib.rs                  # Tauri entrypoint + dialog plugin + managed state + 10-command registry
│   │   ├── error.rs                # AppError enum + Serialize-to-string for IPC
│   │   ├── commands.rs             # Thin handlers (export_write, history_append, http_send, secret_*, storage_*, ws_*) + secret resolution on outbound
│   │   ├── http/                   # client.rs (reqwest, rustls), types.rs, mod.rs
│   │   ├── storage/                # store.rs (atomic JSON), secrets.rs (keyring 3, private get),
│   │   │                           #   resolve.rs ({{secret}} + ctx validation), history.rs, mod.rs
│   │   └── ws/                     # types, request, manager, connection (single-task select!),
│   │                               #   reconnect, backoff, heartbeat, cancel, tls
│   ├── tests/                      # ws_integration, http, storage, keychain round-trip, TLS proof
│   ├── Cargo.toml / Cargo.lock     # tokio-tungstenite 0.29, reqwest 0.13 (rustls), keyring 3; lock committed
│   ├── tauri.conf.json             # Window + bundle config, tight production CSP, dialog:allow-save capability
│   ├── capabilities/default.json   # Permissions (IPC allowlist, dialog:allow-save)
│   └── icons/                      # full Windows/mobile icon set
├── e2e/                            # WebDriver e2e over real WebView2 (npm run e2e)
│   ├── run-e2e.mjs                 # runner: boots hermetic echo server + tauri-driver
│   ├── tauri-e2e.mjs               # zero-dep W3C WebDriver client
│   └── local-echo-server.mjs       # hermetic ws + node:http echo (no external network)
├── design/                         # Reference prototype (read-only) — Relay.html, *.jsx, css
├── plans/260602-1457-socketman-tauri-rust-workbench/   # plan.md + phase-XX + reports
├── docs/                           # this doc set + journals/
├── index.html, package.json, vite/vitest/tsconfig
└── scripts/assert-csp.mjs          # CI gate: CSP has no unsafe-eval in script-src
```

> Branding: only `relay.*` localStorage **migration** keys survive from the Atomiton/Relay prototype; all user-facing branding is SocketMan.

## Key Modules & Responsibilities

### Transport Layer (the seam)

**`src/transport/transport.ts`** — stable TS/Rust-mirrored interface:

```ts
interface Transport {
  wsConnect(cfg, onFrame, onStatus, secrets?): Promise<connId>;
  wsSend(connId, payload, secrets?): Promise<void>;
  wsDisconnect(connId): Promise<void>;
  httpSend(req, secrets?): Promise<HttpResponse>;
  storageLoad(name): Promise<unknown>;
  storageSave(name, data): Promise<void>;
  secretSet(envId, key, value): Promise<void>;   // NO secretGet by design
  secretDelete(envId, key): Promise<void>;
  historyAppend(entry): Promise<void>;
  exportSave(suggestedName, filters, contentFor): Promise<path | null>;  // native dialog + Rust write
}
```

`secrets` is `{ envId, secretKeys }` — only secret KEYS cross to Rust; values are resolved Rust-side from the keychain.

**`src/transport/index.ts`** — runtime selector: `__TAURI_INTERNALS__` present → `tauriTransport`; `VITE_TRANSPORT` can force `mock`/`tauri`; fallback mock (Vitest/jsdom/browser dev).

**`src/transport/tauri-transport.ts`** — `invoke("ws_connect", { config, env_id, secret_keys, channel })` with a fresh `ipc::Channel<ChannelMsg>`; `channel.onmessage` routes frames/status/errors; errors surfaced as sys frames.

### State Management

**`src/hooks/use-workspace-store.ts`** (432 LOC — exceeds the 200-line target by design; the prototype cross-couples item/connection/message state, so `duplicate` etc. mutate urls+conns+msgs atomically and splitting would force circular imports). Owns collections, per-item connection state (url map, frame log, status), saved messages, `connMeta` (per-item headers/auth), active item/format/draft, pause state. Uses `useRef` (connIdMap, pausedRef, envRef, metaRef) to avoid stale closures in async transport callbacks.

**Thin hooks:** `use-environments` (env CRUD + keychain), `use-http` (drives `http_send`), `use-history` (history.json), `use-panels` (UI widths, no persistence), `use-tweaks` (dark/accent/density → localStorage).

### Secret Resolution (security-critical)

Two-layer model:
- **Frontend (`resolve-env.ts`)** resolves non-secret `{{key}}` tokens; with `{ skipSecret: true }` it leaves secret tokens literal so values never enter the JS heap. `secret-refs.ts` packages `{ envId, secretKeys }`.
- **Rust (`storage/resolve.rs`)** resolves `{{secret}}` on the outbound path inside `ws_connect`/`ws_send`/`http_send` via the PRIVATE `storage::secrets::get` (keychain). Per-context validation (header CRLF rejected, URL percent-encoded). Frame/history logs keep the template; resolved URL secrets are collected into `ConnectConfig.redact` (`#[serde(skip)]`) and scrubbed from error strings.

`secret_get` is never a Tauri command (the resolver is Rust-internal) — the webview cannot read secrets back.

### Format System (gated lossless)

`formats/serialize.ts` dispatches `serialize`/`parseFmt` over JSON / YAML / XML / text. JSON uses native stringify/parse (no loss). **YAML now uses `js-yaml` with JSON_SCHEMA — lossless for JSON-object payloads** (was hand-rolled "view-only"). **XML uses `fast-xml-parser`** — known lossy cases (single-element-array collapse, numeric-string coercion) are **documented in the test**.

### Toast Notifications (Track 1, Phase 1)

`hooks/use-toasts.ts` — module-singleton store for UI toast notifications. Mounted in `App.tsx` via `toast-host.tsx`. Used by `env-editor` to surface `secretSet`/`secretDelete` keychain failures (no more silent failures); validation + export status also flow through toasts.

### Export & Copy (Track 1, Phase 2)

`lib/export-file.ts` — `copyText()`, `saveText()`, `saveFrameLog()` helpers driving copy/save buttons in the UI. Uses the Transport's `exportSave()` method (native dialog + Rust write). Frame log exports offer both `.json` (structured frame array) and `.txt` (readable log) formats; HTTP response exports are plaintext. All exports carry **TEMPLATES only** (`{{token}}` never resolved).

### Code Generation (Track 1, Phase 4)

`lib/codegen/` — to-curl.ts, to-fetch.ts, to-wscat.ts, escaping.ts. Generates curl, fetch, wscat code snippets from HTTP requests and WS connections. Snippets skip secret resolution (emit literal `{{token}}` templates). Integrated into "Copy as ▾" dropdowns in the HTTP workspace and WS Headers pane. All targets validated by format round-trip tests.

### Log Filter & Search (Track 1, Phase 3)

`hooks/use-log-filter.ts` + `components/log-filter-bar.tsx` — frame log search and direction filter with match count. `log-stream.tsx` virtualizes the frame list via `@tanstack/react-virtual` (sticky-to-bottom scroll preserved, dense rendering). Replaced the old all/sent/recv toggle with this unified filter.

### Rust Backend

- **`lib.rs`** — manages `WsManager` / `HttpClient` / `StorageManager` (app_data_dir set in `setup`); registers the dialog plugin; registers handlers (alphabetized, 10 total): `export_write`, `history_append`, `http_send`, `secret_delete`, `secret_set`, `storage_load`, `storage_save`, `ws_connect`, `ws_disconnect`, `ws_send`. On window-destroy: `shutdown_all()`.
- **`commands.rs`** — thin handlers (10 total). Outbound commands (`ws_connect`, `ws_send`, `http_send`) resolve secret tokens Rust-side before send. `export_write(path, contents)` (Track 1, Phase 2) writes to a user-picked path via the dialog plugin; no fs plugin, narrowest scope.
- **`ws/`** — `manager` hoists `(tx, rx)` + stable connId above any single socket so queued sends survive a reconnect; `connection` runs one `select!` over read half / command rx / heartbeat tick / coalesce tick / cancel (both socket halves in one task avoids the rustls split deadlock); `reconnect`+`backoff` (capped exponential + jitter); `heartbeat` (explicit `awaiting_pong`); `cancel` (~30-line `Notify` token); `tls` (SecureNativeRoots default vs InsecureNoVerification opt-in); `request` (custom upgrade headers — the capability that justified the Rust backend).
- **`http/`** — one strict reqwest client (rustls native roots, no insecure path), 16 MiB cap, URL-stripped errors.
- **`storage/`** — atomic JSON store, keyring-3 secrets (private `get`), Rust-side resolution, append-only history.

## Testing

- **Frontend (38 Vitest):** format round-trip, env resolution (secret-skip), `use-http`, `use-history`, `secret-refs`, app-boot smoke. CI gates: tsc strict, Vitest, CSP assertion (`scripts/assert-csp.mjs`).
- **Rust (57):** WS upgrade Authorization / echo / status flow / reconnect-stable / queued-send-survives-swap / no conn-map leak / secret redaction / `wss://` TLS proof; HTTP echo + error mapping; storage E2E (no plaintext leak) + real Windows-keychain round-trip.
- **E2E (`npm run e2e`):** `tauri-driver` over real WebView2 drives the built release app against a hermetic local echo server — the only layer that catches JS↔Rust IPC/Channel protocol skew (it caught the 2.1.1→2.11.0 Channel field-rename bug).

## Security Model

1. Secrets stay Rust-private — only keys cross to Rust; values resolved Rust-side at send.
2. No `secret_get` command — keychain reads are Rust-internal only.
3. Logs keep templates; resolved secrets (incl. URL secrets) never logged and scrubbed from errors.
4. Exports carry **TEMPLATES only** (`{{token}}` never resolved); code-gen snippets emit literal secret tokens.
5. Tight CSP (`script-src 'self'`, no `unsafe-eval`/`unsafe-inline`), gated by `npm run build`.
6. IPC surface is an explicit allowlist of **10 commands** (added `export_write` for safe user-picked file writes; no fs plugin, narrowest scope).

## Size & Metrics

- Frontend: ~5.8k LOC `.ts/.tsx` (largest: `use-workspace-store.ts` 432).
- Rust: ~2.3k LOC (largest: `ws/connection.rs` 262, `ws/types.rs` 206, `http/client.rs` 174).
- Tests: Vitest 85 (was 38, +47 for Track 1 features); Rust 57; E2E 5/5.
- Installers: MSI 6.1 MB, NSIS setup.exe 3.9 MB.

## Constraints & Limitations (v1)

- **Platform:** Windows-first — keyring uses `windows-native`; packaging is NSIS/MSI. macOS/Linux deferred.
- **Network:** WS + HTTP only — no SSE/Socket.IO/MQTT; text WS frames only (no binary); no Postman import (own JSON format).
- **TLS:** native-roots strict by default; per-connection insecure toggle (full MITM, opt-in, warned); no cert pinning.
- **YAML/XML:** YAML now lossless for JSON-object payloads (via `js-yaml` JSON_SCHEMA); XML best-effort (inherent data-model losses asserted). JSON is the canonical lossless format.

## Open Items (non-blocking)

- Manual GUI install smoke test of the packaged app (Phase 7 acceptance item; cannot run headlessly).
