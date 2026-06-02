---
phase: 6
title: "Rebrand & History"
status: pending
priority: P2
effort: "1-2d"
dependencies: [5]
---

> **Red-team applied (2026-06-02):** history append is the **Rust `history_append` command** from Phase 5
> (load-append-cap under the file mutex), NOT a frontend read-modify-write of connection state — this is
> what guarantees templates-only and avoids the append race (S2/F6). `use-history` reads/clears via
> storage; the append call sites pass template data to Rust.

# Phase 6: Rebrand & History

## Overview

Strip all "Atomiton Relay" branding, replace the demo collections/messages/environments with neutral
**SocketMan starter content**, and wire the **History** feature (currently absent in the prototype) to
the persisted `history.json` from Phase 5 — a chronological log of HTTP requests and WS session
summaries that the user can revisit/replay.

## Key Insights

- Branding lives in: window title/identifier (done Phase 1 config), `starter-data.ts` (Atomiton URLs,
  plant telemetry sample messages, env names/tokens), copy strings in components, and the prototype's
  `relay.*` localStorage keys (now superseded by JSON store, but migration code references them).
- Starter content should be **self-explanatory and vendor-neutral**: a public echo WS endpoint, an
  httpbin/postman-echo HTTP request, and a "Local" environment — so a fresh install is immediately
  usable for real testing, not a dead demo.
- History is genuinely new UI. Keep it small: a panel/tab listing entries `{id, ts, kind: ws|http,
  label, summary, payload}`; clicking loads it back into the composer (WS) or request editor (HTTP).
  **Append is Rust-side** (`history_append`, Phase 5): HTTP responses append on send, WS sessions append a
  summary on disconnect — the call sites hand Rust the **template** form (pre-resolution), and Rust does
  the load-append-cap-write under the file mutex. The frontend never serializes its (possibly
  secret-resolved) connection state to disk.

## Requirements

**Functional**
- Zero "Atomiton"/"Relay" strings in shipped UI/code (except this plan + the read-only `design/` ref).
- Starter data: 1–2 collections with a working public WS endpoint + a working HTTP request; a default
  "Local"/"Playground" environment (no real secret values committed — placeholders only).
- History panel: lists persisted entries newest-first; filter by ws/http; click to reload into the
  relevant editor; clear-history action; entries persisted via `history.json`.
- HTTP send appends a history entry (request + status + timing). WS disconnect appends a session summary
  (url, duration, frame counts). Sensitive values stored as **templates** (per Phase 5), never resolved.

**Non-functional**
- History list virtualization not required for v1 (cap entries, e.g. last 500) — document the cap.
- Rebrand must not break persisted-data migration (key names referenced in migration stay correct).

## Architecture

- `src/data/starter-data.ts`: rewrite `COLLECTIONS`, `MESSAGES`, `ENVIRONMENTS` with SocketMan-neutral
  content + public test endpoints.
- `src/hooks/use-history.ts`: **read/clear** via `transport.storageLoad("history")` / a clear command;
  **append goes through Rust `history_append`** (not a frontend save). The append call sites are
  `use-http` (on response) and `use-connections` (on disconnect), passing template-form entries.
- `src/components/history-panel.tsx`: list + filter + reload + clear. Mount in the existing layout
  (e.g. a sidebar tab or top-nav entry — reuse existing nav/list CSS).
- Global string sweep: replace product copy; update `tauri.conf.json` already SocketMan; app icon set in
  Phase 7.

## Related Code Files

**Create:** `src/hooks/use-history.ts`, `src/components/history-panel.tsx`,
`src/hooks/__tests__/use-history.test.ts`.

**Modify:** `src/data/starter-data.ts` (rebrand + neutral content), `src/components/top-nav.tsx` (title/
brand + History entry point), `src/hooks/use-http.ts` (append history on response), `src/hooks/use-connections.ts`
(append session summary on disconnect), any component with "Relay"/"Atomiton" copy.

## Implementation Steps (TDD)

1. **String sweep:** `grep -rin "atomiton\|relay" src/` → replace all shipped occurrences; keep a short
   allow-list (migration key names) and document why.
2. **Rewrite `starter-data.ts`** with neutral content + verified-working public endpoints (echo WS +
   echo HTTP) and placeholder env (no committed secrets).
3. **TDD — history tests:** Rust `history_append` ordering (newest-first), cap at 500 (oldest dropped),
   **concurrent appends don't lose entries** (the Phase 5 mutex), clear empties it, entries persist.
   `use-history` read/clear/reload covered with the storage shim.
4. **Build `history-panel.tsx`** + mount; wire reload-into-editor for both kinds.
5. **Wire append points:** `use-http` on response; `use-connections` on disconnect → call `history_append`
   with **template-form** entries. Regression test: a session/request carrying a `{{secretToken}}` appends
   the template, and grepping `history.json` finds no resolved secret.
6. **Gate:** `npm test` green; manual: send HTTP + run a WS session → both appear in History across a
   restart; clicking reloads them; no Atomiton strings remain.

## Todo List

- [ ] All Atomiton/Relay strings removed from shipped code (grep clean except documented allow-list)
- [ ] `starter-data.ts` rewritten: neutral, working public endpoints, no committed secrets
- [ ] History tests first, green (order, cap, clear, persist, concurrent-append no loss)
- [ ] History panel built + mounted; reload-into-editor works (ws + http)
- [ ] Append via Rust `history_append` (not frontend save); templates only, verified by grep test
- [ ] Manual: history survives restart; reload works; brand gone

## Success Criteria

- [ ] Acceptance: UI shows SocketMan branding only; fresh install has usable starter content.
- [ ] History persists HTTP + WS activity across restart; entries reload into the right editor; clear works.
- [ ] No resolved secret appears in any history entry (test-asserted).
- [ ] `npm test` green; visual polish consistent with prototype CSS.

## Risk Assessment

- **Rebrand breaks migration** (renamed keys) → keep migration referencing the original `relay.*` keys;
  only display copy changes.
- **Dead public endpoints** in starter data → choose stable ones (echo.websocket.events /
  postman-echo); document that they're examples and swappable.
- **History bloat** → hard cap (500) + clear action; note virtualization as future work.

## Security Considerations

- History must store unresolved templates (depends on Phase 5 invariant); add a regression test so a
  future change can't start logging resolved secrets.
- Starter env ships placeholder values only; no real tokens in the repo.

## Next Steps

Phase 7 produces the Windows installer + icons + release build.
