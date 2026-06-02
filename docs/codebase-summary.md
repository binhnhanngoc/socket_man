# SocketMan Codebase Summary

**Phase 1 Status:** Complete. Tauri 2 + React/TS frontend with mock transport; Rust backend skeleton ready for Phase 2 real IPC.

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
├── src-tauri/                      # Rust backend
│   ├── src/
│   │   ├── main.rs                 # Windows subsystem wrapper
│   │   └── lib.rs                  # Tauri entrypoint; command registry appended in Phase 2+
│   ├── Cargo.toml                  # Dependencies (tauri 2.11, tokio, reqwest, keyring, etc.)
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

### Transport Layer (The Seam)

**`src/transport/transport.ts`** — The interface that decouples UI from networking:

```ts
interface Transport {
  wsConnect(cfg: ConnectConfig, onFrame, onStatus): Promise<connId>;
  wsSend(connId, payload): Promise<void>;
  wsDisconnect(connId): Promise<void>;
  httpSend(req: HttpRequest): Promise<HttpResponse>;
}
```

- **Phase 1:** `mock-transport.ts` simulates a server (600ms connect latency, tick frames, echo replies).
- **Phase 2+:** Real Tauri command bridge to Rust (WS via tokio-tungstenite, HTTP via reqwest).
- **Why the seam:** Browser `WebSocket` API cannot set custom upgrade headers (esp. `Authorization`). Rust owns the wire.

**`ConnectConfig`** — Phase 1 minimal: `{ url, headers }`. Reliability fields (heartbeatSecs, reconnect, insecureTls) added Phase 3 when honored.

### State Management (Coordinating Store)

**`src/hooks/use-workspace-store.ts`** (305 LOC — exceeds 200-line target intentionally per F15):
- **Why one store:** The prototype `App()` cross-couples item/connection/message state. Ops like `duplicate` mutate urls + conns + msgs atomically. Splitting into five hooks forces circular imports of setters → worse coupling.
- **Owns:** Collections, connections (url map, frame log, status), messages (saved payloads), active item/format/draft, pause state.
- **Exposes:** `connect(itemId)`, `send(connId, payload)`, `disconnect(connId)`, `addFrames()`, `duplicateItem/Collection()`, name editors.
- **Refs:** Uses `useRef` to avoid stale closures in transport callbacks (transport runs async, state updates are sync).

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

### Components (UI Port)

All `.jsx` from `design/` ported to `.tsx`:
- **Top nav:** Theme/density/env switcher.
- **Sidebar:** Collections tree, item list, nested rename/duplicate.
- **Message library:** Saved payloads per collection.
- **WS workspace:** Connection bar (connect/disconnect, status), live log stream with pause, composer, format tabs (JSON/YAML/XML/Text), Headers/Auth/Settings panes.
- **HTTP workspace:** Method/URL/headers form, response viewer.
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

## Next: Phase 2 (Planned, Not Yet Built)

- **Real Rust transport:** ws_connect/send/disconnect (tokio-tungstenite), http_send (reqwest).
- **IPC bridge:** Tauri `Command` handlers + `ipc::Channel<ChannelMsg>` streaming for frames/status/errors.
- **Custom upgrade headers:** Set Authorization on WS upgrade (impossible in browser WebSocket API, trivial in Rust).
- **Backend skeleton:** Shared `error.rs`/`lib.rs` builder + command registry (alphabetized), disjoint `ws/` and `http/` modules.

---

## Size & Metrics

- **Frontend:** ~17 .ts/.tsx files, 200-line modular target (workspace store 305 LOC exceeds with rationale).
- **Rust:** lib.rs minimal (near-empty in Phase 1).
- **CSS:** 1500+ lines (verbatim from design/).
- **Tests:** 29 passing, TDD gates on format round-trip + env resolution + smoke.
- **Bundle:** ~2.5 MB (Tauri + React runtime + bundled assets).

---

## Constraints & Limitations (v1)

- **Secrets in localhost dev:** Plaintext in `%APPDATA%/SocketMan/` (Phase 5 uses OS keychain).
- **Persistence in Phase 1:** localStorage only (mock transport, no real state). Phase 5 moves collections/envs to JSON files.
- **YAML/XML:** Best-effort (view-only); numeric coercion, single-element collapse; JSON is the lossless path.
- **Platform:** Windows-first (WebView2 preinstalled on Win11). Cross-platform build deferred (Phase 7).
- **TLS v1:** No custom cert pinning or per-host insecure toggles yet (Phase 3).
