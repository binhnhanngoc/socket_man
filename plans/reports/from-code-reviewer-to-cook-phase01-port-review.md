# Phase 1 Port — Code Review (code-reviewer → cook)

**Date:** 2026-06-02
**Scope:** `src/**`, `src-tauri/tauri.conf.json` — greenfield Tauri2+Vite+React+TS port of `design/*.jsx`.
**Verdict:** Security contracts all PASS. One High-severity correctness bug (zombie connection on disconnect-during-connecting). Rest is clean.

---

## Security Contracts (locked, non-negotiable) — ALL PASS

| # | Contract | Result | Evidence |
|---|----------|--------|----------|
| F1 | Secret-skipping resolver leaves `{{token}}` literal when `skipSecret` + `secret:true` | **PASS** | `src/lib/resolve-env.ts:37` — `if (opts.skipSecret && v.secret) return match;` |
| F1 | Every send/connect/URL-preview call site passes `skipSecret:true` | **PASS** | connect: `use-workspace-store.ts:138`; preview: `connection-bar.tsx:27`. Grep of all `resolveEnv(` calls confirms NO outbound/display call omits it. |
| F24 | `ConnectConfig` minimal `{url, headers}`, no reliability/TLS fields | **PASS** | `transport/transport.ts:10-15` — exactly `url` + `headers`. |
| F24 | `onFrame` receives Frame ARRAYS | **PASS** | `transport.ts:59` `onFrame: (f: Frame[]) => void`; mock always calls with arrays. |
| F7 | JSON = gated lossless; YAML/XML = documented subset; no xfail-as-green | **PASS** | `format-round-trip.test.ts` — JSON asserts `toEqual` over all 7 samples; YAML/XML only test the documented subset; XML coercion asserted honestly (`"007"→7`). Limitations comments match `yaml.ts`/`xml.ts` behavior. |
| F22 | Tweaks → localStorage; host `postMessage` edit-mode GONE; gear opens controlled panel | **PASS** | `use-tweaks.ts` persists to `relay.tweaks`; `postMessage`/`window.parent` only in explanatory comments (grep-confirmed); `App.tsx:130` `<TweaksPanel open={tweaksOpen} ...>`, gear at `App.tsx:44`. |
| F12 | CSP exact match | **PASS** | `tauri.conf.json:24` byte-for-byte matches the locked string. |

No secret value can reach the JS heap or DOM on any traced path. Contract review is clean.

---

## Findings by Severity

### Critical
None.

### High

**H1 — Zombie connection + interval leak on Disconnect during the `connecting` window.**
`src/transport/mock-transport.ts:29-42`, interacts with `src/hooks/use-workspace-store.ts:157-161`.

Repro: click Connect, then Disconnect within the 620ms `CONNECT_DELAY_MS` window (the UI shows the Disconnect button during `connecting`, so this is reachable by a normal fast click).

- `wsConnect` schedules a `setTimeout(620)` that has **no cancellation path**. It returns the connId immediately; the `conns` Map entry + tick interval are created only *inside* that timeout.
- `disconnect()` calls `transport.wsDisconnect(connId)`. `wsDisconnect` (`:64-71`) only acts when `conns.get(connId)` exists — during `connecting` it does not, so it is a **no-op**: no `clearInterval`, no `closed` frame, nothing deleted.
- 620ms later the timeout fires anyway → registers the conn, **starts a tick interval that now never gets cleared**, flips status back to `"connected"`, and emits the welcome frame.

Net: a socket the user explicitly disconnected ends up `connected` with a forever-running tick, contradicting intent and leaking timers. Status also desyncs (store set `disconnected`, then mock overrides to `connected`).

Why the prototype didn't manifest this: its tick was gated on `status==="connected" && id===activeId` (`design/app.jsx:271`), so a stale post-disconnect tick could not fire. The port moved the tick into the transport and made it unconditional per-connection, which surfaces the latent race.

Recommended fix (Phase 1, mock): make `wsConnect` cancellable — store a `cancelled` flag / the timeout handle in a pending map keyed by connId; have `wsDisconnect` clear the pending timeout and mark cancelled so the timeout body bails. Carry the same guard into the Phase 2 Rust transport (the connecting→cancel window exists there too).

### Medium

**M1 — `disconnect()` emits no `closed` frame when not yet connected; silent disconnect.**
`use-workspace-store.ts:157-161`. Because of H1, disconnecting during `connecting` produces no `sys/closed` log frame (prototype always emitted one at `app.jsx:289`). Minor UX/log-fidelity drift; fixing H1 (so `wsDisconnect` runs the closed-frame path even for a pending conn) also resolves this.

**M2 — Background sockets now tick forever (intentional, but document it).**
`mock-transport.ts:34`. Prototype ticked ONLY the active connected socket (`app.jsx:271`); the port ticks every connected socket continuously. Plan says "the mock owns the tick now," so this is a deliberate, more-realistic change — but it means non-active connected sockets accumulate frames up to `MAX_FRAMES` in the background. Acceptable for Phase 1; flag for Phase 2 so the real transport's frame buffering matches expectations. Not a bug.

### Low

**L1 — No transport teardown on App unmount.** No effect calls `wsDisconnect` for live conns when the tree unmounts. Harmless for a single-window Tauri app in Phase 1; revisit if multi-window/HMR churn causes orphaned Rust connections in Phase 2.

**L2 — Duplicated WS item starts ticking only on connect (fine), but `connIdMap` entries are never pruned on item delete.** Phase 1 has no delete-item path, so inert now; note for when delete lands.

**L3 — `sendBody` hardcodes `serialize(body, "json")`** (`use-workspace-store.ts:165`). Correct for Phase 1 (mock JSON-parses it back), and matches the "Rust sends bytes verbatim" comment. Just confirm Phase 2 sends the user's selected wire format rather than always-JSON if that's ever desired (prototype passed the raw object to the fake server; behavior is equivalent for JSON-able bodies).

---

## Correctness Trace vs Prototype (`design/app.jsx`) — clean except H1

- **Pause filter:** `TICK_KINDS = {telemetry, alert, tick}` + `dir==="in"` (`store:27,119`) exactly matches the only kinds/dir the tick emits (`mock-server-simulation.ts:61-82`). Pause does not drop welcome/ack/echo/reply, and neither did the prototype. MATCH.
- **duplicateItem / duplicateCollection / ensureWsState:** cross-state mutation (urls+conns+msgs) faithfully ported (`store:222-271` vs `app.jsx:307-337`), including `setActiveId(nid)+setActiveMsgId(null)` after item dup. MATCH.
- **connect/send/disconnect:** functional `setConns` updates compose correctly; closed frame (dir "sys") survives the pause filter; `byteSize` (`util.ts:20`) identical to prototype. MATCH (except H1 window).
- **Stale closures:** `pausedRef`/`envRef`/`connIdMap` refs (`store:96-100`) correctly avoid stale reads in transport callbacks. The `connect` callback reads `envRef.current` (live) and `urls` from deps — fine. No stale-closure bug found.
- **React keys:** all list keys use stable ids (`f.id`, `m.id`, item/coll ids) — grep for non-id keys returned nothing. No key/reconcile issues.
- **changeFmt:** wrapped in functional `setDraft` with try/catch (`store:179-192`) — safer than prototype's read-then-set. MATCH/improved.

## Phase-2-swap readiness
Transport seam is clean: components/hooks import only `transport` + interface types from `src/transport`. Swapping `index.ts:8` to a Rust-backed impl needs zero component changes — provided the real transport (a) reproduces the array-shaped `onFrame`, and (b) fixes the H1 connecting→cancel race rather than copying the mock's structure.

## Build / Test gates (as reported, spot-checked by reading)
tsc strict + vite build clean; cargo build clean; 27 vitest tests; CSP assert passes; globals eliminated. Test content reviewed — assertions are real (no fabricated lossy green). Consistent with the stated gate results.

---

## Unresolved Questions
1. H1 fix scope: patch the mock now (recommended — it's a real reachable bug and a template for Phase 2), or defer to Phase 2 with a tracked note? Mock-only fix is ~10 lines.
2. M2: is per-connection background ticking the intended Phase-2 semantic (real WS keeps receiving when not focused), or should non-active sockets be throttled/buffered differently? Confirms expected frame-buffer growth behavior.
