---
phase: 1
title: "Scaffold & UI Port"
status: done
priority: P1
effort: "5-7d"
dependencies: []
completed: "2026-06-02"
---

> **Completed 2026-06-02 (cook).** Full prototype ported to `.tsx` behind the mock
> `Transport`. Gates green: `npm run build` (tsc strict + vite), `cargo build`,
> 29 vitest tests (JSON round-trip gated + secret-skip resolver + mock-transport +
> App boot smoke), CSP assert, globals eliminated. Self-hosted fonts (dropped the
> Google Fonts CDN @import for offline + tight CSP). Code-review: all 6 locked
> security contracts pass; one High bug found+fixed (mock disconnect-during-connect
> zombie + tick leak, `mock-transport.ts`) with a regression test. Deferred to
> Phase 2: wire real IPC `connect-src`, per-connection tick semantics (reviewer M2).

> **Red-team applied (2026-06-02):** secret-skipping resolver (F1), format round-trip honesty (F7),
> coordinating workspace store (F15), localStorage-backed `useTweaks` (F22), minimal `ConnectConfig`
> (F24), exact production CSP (F12), widened effort + concrete parity scope (F27). Optionally split
> into **1a** (scaffold + tooling + pure-lib/format TDD) and **1b** (component port + modularization +
> visual parity) if staffing one dev.

# Phase 1: Scaffold & UI Port

## Overview

Scaffold the Tauri 2 + Vite + React + TS project, then port the entire `design/` prototype to
`.tsx` with ES imports (drop all `window.X` globals). All UI talks to transport through a single
**`Transport` interface**; this phase ships a **mock implementation** that reproduces the old fake
server, so we hit pixel-for-pixel visual parity with zero real networking. Modularize per the
200-line rule. TDD: format serialize/parse round-trips and env-resolution get unit tests now —
they are pure functions reused unchanged in later phases.

## Key Insights

- Prototype loads React/Babel from CDN and wires 10 files via `<script>` + `Object.assign(window, …)`.
  The port replaces this with Vite ESM. Component logic is sound — copy it, don't rewrite it.
- `app.jsx` (437 lines) and `formats.jsx` (267) **must** be split (200-line rule). Natural seams:
  state hooks (connections/collections/environments/panels) and serialize/parse/views.
- The **mock transport** is the seam that lets Phase 2 swap in real Rust with zero UI changes. Define
  the interface from the IPC contract in the brainstorm, not from the mock's convenience.
- **Secret-skipping resolver (security-critical, F1):** the prototype `resolveEnv` (`design/data.js:166`)
  resolves *every* `{{key}}`. The ported resolver MUST take a mode that **leaves secret-var tokens
  literal** (`{{token}}` stays as-is for any var with `secret:true`); only non-secret vars resolve in JS.
  Secret tokens are substituted Rust-side at send/connect (Phase 5). This split is a typed contract from
  day one — Phase 4/5 depend on it. Without it, a secret leaks into the JS heap two phases early.
- `tweaks-panel.jsx` carries a host "edit-mode" postMessage protocol AND `useTweaks` itself persists via
  `window.parent.postMessage` (`design/tweaks-panel.jsx:181`) — there is **no host** in Tauri, so tweak
  prefs (dark/accent/density) would silently NOT persist. **Drop the edit-mode protocol entirely and
  rewrite `useTweaks` to persist to `localStorage`** (matching every other pref). Keep only `TweaksPanel`
  + the form controls `App` uses. (F22)
- **`Channel.onmessage` is a property setter** in Tauri v2 (`channel.onmessage = cb`), not an awaitable
  method — relevant when `tauri-transport.ts` lands in Phase 2; the cited IPC research report's
  `await channel.onmessage(cb)` is wrong. (F6)
- CSS (`app.css`, `colors_and_type.css`) ports **verbatim** — it is the source of visual truth.

## Requirements

**Functional**
- App boots in a Tauri window, renders the full Relay UI (sidebar, message library, WS workspace,
  HTTP workspace, env switcher/editor, tweaks panel) driven by mock transport.
- All interactions from the prototype work: connect/disconnect (simulated), send → simulated replies,
  live tick frames, format switching (JSON/YAML/XML/Text), env switching, collection/message
  rename/duplicate, panel resizing, dark mode, density.
- localStorage persistence of UI prefs + collections/environments preserved (unchanged from prototype
  for now; Phase 5 migrates the data ones to Rust JSON store).

**Non-functional**
- Visual parity with `design/Relay.html` (side-by-side check).
- Every source file ≤200 LOC (excluding CSS/markdown). TypeScript strict mode compiles clean.
- `Transport` interface fully typed and mirrors the Rust IPC contract names exactly.

## Architecture

### Project layout (post-scaffold)
```
socket_man/
├── src/
│   ├── main.tsx, App.tsx
│   ├── transport/
│   │   ├── transport.ts            # Transport interface + types (IPC contract mirror)
│   │   ├── mock-transport.ts       # fake server port (from data.js makeServer)
│   │   └── index.ts                # selects mock now; real tauri impl added Phase 2
│   ├── hooks/
│   │   ├── use-tweaks.ts
│   │   ├── use-connections.ts      # conns map, addFrames, connect/send/disconnect via Transport
│   │   ├── use-collections.ts      # collection tree + rename/duplicate + localStorage
│   │   ├── use-environments.ts     # env CRUD + active env + resolveEnv
│   │   └── use-panels.ts           # sidebar/library widths, collapse, density
│   ├── components/
│   │   ├── top-nav.tsx, collections-sidebar.tsx, message-library.tsx
│   │   ├── ws-workspace.tsx, connection-bar.tsx, log-stream.tsx, log-row.tsx, composer.tsx
│   │   ├── ws-tab-panes.tsx        # Headers/Auth/Settings panes
│   │   ├── http-workspace.tsx
│   │   ├── env-menu.tsx, env-editor.tsx
│   │   ├── tweaks-panel.tsx, resizer.tsx
│   │   └── icons.tsx
│   ├── formats/
│   │   ├── json-view.tsx
│   │   ├── yaml.ts                 # yamlStringify + yamlParse
│   │   ├── xml.ts                  # xmlStringify + xmlParse
│   │   ├── serialize.ts            # serialize/parseFmt dispatch
│   │   └── format-view.tsx         # YamlView/XmlView/TextView/FormatView
│   ├── lib/
│   │   ├── util.ts                 # byteSize, fmtTime, fmtDur, prettyJSON, compactJSON
│   │   └── editable-name.tsx
│   ├── data/starter-data.ts        # COLLECTIONS/MESSAGES/ENVIRONMENTS (still Atomiton here; rebrand Phase 6)
│   ├── types.ts                    # shared domain types (Collection, Item, Message, Env, Frame, ConnStatus)
│   └── styles/{app.css, colors_and_type.css}   # verbatim copy
├── src-tauri/
│   ├── src/{main.rs, lib.rs}       # near-empty: window + (future) command registry
│   ├── Cargo.toml, tauri.conf.json, build.rs
│   └── icons/
├── index.html, package.json, vite.config.ts, tsconfig.json, vitest.config.ts
```

### The Transport interface (contract — mirrors brainstorm IPC §4)
```ts
// transport/transport.ts — Phase 1 keeps this MINIMAL (F24).
// heartbeatSecs / reconnect / insecureTls are added to this interface in Phase 3,
// when they are first honored. Extending optional fields later is non-breaking; the
// mock never needed them, and a Phase 2 Rust struct shouldn't deserialize dead fields.
export interface ConnectConfig {
  url: string;
  headers: Record<string, string>;     // includes Authorization on upgrade
}
export type FrameDir = "in" | "out" | "sys";
export interface Frame { id: number; dir: FrameDir; kind: string; body: unknown; ts: number; size: number; }
export type ConnStatusKind = "disconnected" | "connecting" | "connected" | "reconnecting";
export interface ConnStatus { connId: string; status: ConnStatusKind; connectedAt?: number; reason?: string; code?: number; rttMs?: number; }

export interface HttpRequest { method: string; url: string; headers: Record<string,string>; body?: string; }
export interface HttpResponse { status: number; statusText: string; headers: Record<string,string>; body: string; timingMs: number; sizeBytes: number; }

export interface Transport {
  wsConnect(cfg: ConnectConfig, onFrame: (f: Frame[]) => void, onStatus: (s: ConnStatus) => void): Promise<string>; // connId
  wsSend(connId: string, payload: string): Promise<void>;
  wsDisconnect(connId: string): Promise<void>;
  httpSend(req: HttpRequest): Promise<HttpResponse>;
}
```
> `onFrame` receives **arrays** of frames — the prototype's `addFrames(connId, arr)` is already
> array-shaped (`design/app.jsx:256`), so this matches. Phase 2 emits per-frame arrays; Phase 3 grows
> batch size via coalescing. (No special "len 1" semantics — just emit what's available.)

### Mock transport
Port `data.js makeServer()` behind the interface: `wsConnect` flips to `connected` after ~600ms,
emits a `welcome` frame, starts a 1200ms tick that pushes telemetry batches; `wsSend` echoes the
out-frame then schedules simulated `in` replies; `httpSend` returns the canned `HttpWorkspace`
responses with a fake `timingMs`.

### State hook wiring (F15 — the split is NOT 5 independent hooks)
`App.tsx` shrinks to layout + composition. **Warning:** the prototype `App()` (`design/app.jsx:157-433`,
~277 lines) is cross-coupled — `ensureWsState`/`duplicateItem`/`duplicateCollection` mutate `urls`,
`conns`, AND `msgs` together (`app.jsx:307-337`); `sendSaved` spans connections + draft + format; the
live-tick effect drives both the clock and frame ingestion (`app.jsx:267-277`). Five independent hooks
would have to import each other's setters (worse coupling). Instead:
- Introduce a **coordinating `use-workspace-store`** (a `useReducer` or a small store) that owns the
  shared item/connection/message state and the cross-state duplicate/send operations atomically.
- Thinner hooks (`use-environments`, `use-panels`, `use-tweaks`) wrap genuinely independent state.
- `use-connections` exposes the `Transport`-calling surface (`connect/send/disconnect/addFrames`) over
  the store — Phase 2 swaps the `Transport` impl with **no hook signature change**.
- **200 LOC is a target, not a hard gate here** (per the modularization rule's "logical separation
  boundaries" clause): the workspace store may exceed it with a documented rationale rather than be
  fragmented into artificially-coupled pieces. The 1200ms `setNow` clock stays in `App` (UI-only).

### Production CSP (F12 — security)
Babel/CDN is dropped, so `unsafe-eval`/`unsafe-inline` are NOT needed. Ship this exact CSP in
`tauri.conf.json` (do NOT copy the research report's `'unsafe-inline' 'unsafe-eval'` example):
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:
```
(`style-src 'unsafe-inline'` only if a ported component needs inline styles — prefer classes.) Add a CI
assertion that the built config's `script-src` contains neither `unsafe-eval` nor `unsafe-inline`. This
matters because `secret_get` is never exposed (Phase 5) and the only injection→IPC path is script eval.

## Related Code Files

**Create:** entire `src/**` tree above, `src-tauri/{Cargo.toml,tauri.conf.json,src/main.rs,src/lib.rs,build.rs}`,
`index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`,
`src/transport/*`, `src/formats/__tests__/*`, `src/hooks/__tests__/use-environments.test.ts`.

**Port from (read, translate, do not import):** all `design/*.jsx`, `design/data.js`,
`design/app.css`, `design/colors_and_type.css`.

**Delete/omit:** `design/Relay.html` CDN harness, the edit-mode protocol in `tweaks-panel.jsx`.

## Implementation Steps

1. **Scaffold.** `npm create tauri-app@latest` → React + TS template into the repo (or scaffold in a
   temp dir and move files in, since `design/` already occupies the root). Pin `@tauri-apps/cli@2.11`,
   `@tauri-apps/api@2`. Configure `tauri.conf.json` per research (productName SocketMan, identifier
   `com.socketman.app`, 1200×800, devUrl 5173). Verify `npm run tauri dev` opens a blank window.
2. **Tooling.** Add Vitest + `@testing-library/react` + jsdom. `vitest.config.ts`, test script.
   Enable `tsconfig` strict. Confirm `npm test` runs.
3. **TDD — formats first (HONEST gate, F7).** Copy `formats.jsx` logic into `formats/yaml.ts`, `xml.ts`,
   `serialize.ts`. The hand-rolled YAML/XML parsers are **structurally lossy** (single-element arrays
   round-trip to strings — `formats.jsx:179`; numeric-strings coerce to numbers — `formats.jsx:171`;
   null/empty collapse — `formats.jsx:151`). So:
   - **JSON is the gated invariant:** `parseFmt(serialize(obj,'json'),'json')` deep-equals obj for every
     sample body — MUST pass, no exceptions.
   - **YAML/XML are view-only / best-effort:** test only the documented lossless subset; the lossy
     classes are written as an explicit, reviewed **"known limitations" list in the test file**, NOT as
     xfail tests that let a broken gate read "green". A green format suite must mean JSON round-trips and
     YAML/XML render correctly — never that real failures were silently excluded.
4. **TDD — env resolution (secret-skipping, F1).** `hooks/use-environments.ts` exposes
   `resolveEnv(str, env, { skipSecret })`. Write `use-environments.test.ts` first: non-secret
   `{{ws_url}}/x` resolves; unknown token left verbatim; null env returns input; **and with
   `skipSecret:true`, a `{{token}}` whose var is `secret:true` is left LITERAL** (asserts the resolved
   string still contains `{{token}}`). The send/connect/HTTP paths always call with `skipSecret:true`.
   Implement.
5. **Port pure libs:** `lib/util.ts` (byteSize/fmtTime/fmtDur/json helpers), `lib/editable-name.tsx`,
   `components/icons.tsx`, `formats/json-view.tsx` + `format-view.tsx`.
6. **Define `transport.ts`** interface + types, then `mock-transport.ts` (port `makeServer`), then
   `transport/index.ts` exporting the mock. Type everything; no `any`.
7. **Port components** `.jsx→.tsx` with typed props: sidebar, library, workspace, connection-bar,
   log-stream/row, composer, ws-tab-panes, http-workspace, env-menu/editor, tweaks-panel, resizer.
   Replace `window.X` references with imports.
8. **Split `App`** via the coordinating `use-workspace-store` + thin hooks (`use-environments`,
   `use-panels`, `use-tweaks`); `App.tsx` composes them + layout. Target ≤200 LOC; the store may exceed
   with a documented rationale (F15). **Rewrite `useTweaks` to persist to `localStorage`** and strip the
   `window.parent.postMessage`/`tweakchange`/EDITMODE-marker code (F22) — add a test/check that dark/
   accent/density survive a reload.
9. **Copy CSS verbatim** into `src/styles`, import in `main.tsx`. Wire `--accent`, `data-density`, dark.
10. **Visual parity pass.** Run dev app beside `design/Relay.html`; diff sidebar, log rows, composer,
    env editor, tweaks. Fix CSS class/markup drift.
11. **Compile gate:** `npm run build` (tsc + vite) and `cargo build` (src-tauri) both clean.

## Todo List

- [x] Tauri+Vite+React+TS scaffold boots a window (`cargo build` clean; `npm run dev` serves 200)
- [x] Vitest harness runs
- [x] JSON round-trip gated green; YAML/XML lossless-subset tested + limitations documented (no xfail-as-green)
- [x] Env-resolution tests written first, then green — incl. `skipSecret` leaves secret tokens literal
- [x] `useTweaks` persists to localStorage; host edit-mode protocol dropped (F22)
- [x] Production CSP has no `unsafe-eval`/`unsafe-inline` in script-src (CI assert via `scripts/assert-csp.mjs`)
- [x] `ConnectConfig` is minimal `{url, headers}`; reliability/TLS fields deferred to Phase 3
- [x] Pure libs ported (util, icons, json/format views, editable-name)
- [x] `Transport` interface + mock transport implemented and typed
- [x] All components ported `.tsx`, no global-namespace `window.*` wiring remains (only standard DOM APIs)
- [x] `App` split into hooks; files ≤200 LOC except documented F15 store (304) + cohesive yaml.ts (205) / sidebar (203)
- [x] CSS ported verbatim (fonts self-hosted, not CDN); App boot smoke test renders the full tree
- [x] `npm run build` + `cargo build` clean

## Success Criteria

- [ ] Visual parity vs `design/Relay.html` across the **enumerated states**: sidebar (collapsed/expanded,
      status dots), message library, WS workspace (each tab; empty/connected/streaming log; split + unified),
      composer (valid/invalid badge), HTTP workspace, env menu + editor, tweaks panel, dark mode, both
      densities. (Parity scope is this list — not unbounded. F27)
- [ ] All prototype interactions work through the **mock** `Transport`.
- [ ] `grep -rn "window\." src/` returns nothing (globals eliminated).
- [ ] No source file (excl. CSS/md) exceeds 200 LOC.
- [ ] `npm test` green; `npm run build` and `cargo build` succeed.

## Risk Assessment

- **Scaffold collides with existing `design/`** → scaffold elsewhere, copy in; keep `design/` as
  read-only reference (do not delete until Phase 6 verifies parity).
- **Modularization breaks subtle state coupling** (e.g. `ensureWsState` on duplicate) → port behavior
  first in one file, split second; keep a manual interaction checklist.
- **Hand-rolled YAML/XML round-trip failures** → capture as documented xfail limits, not blockers (v1
  scope per brainstorm §6); JSON is the primary format.

## Security Considerations

- No secrets yet (Phase 5). Keep `tauri.conf.json` CSP tight; avoid `unsafe-eval` in production build
  (Babel CDN is gone). Allowlist only the commands that exist.

## Next Steps

Phase 2 implements the real Rust `Transport` and swaps `transport/index.ts` — no component changes.
