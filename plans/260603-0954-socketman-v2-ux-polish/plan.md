---
title: "SocketMan v2 Track 1 — UX & Polish"
description: "v2 Track 1 — UX & Polish for SocketMan: notifications + keychain feedback, copy/save/export, search/filter + log virtualization, code-gen export, and lossless YAML/XML. Windows-first; preserves the locked secret model + Tauri version-lock + CSP gate."
status: complete
priority: P2
branch: "master"
tags: [ux, tauri, react, typescript, polish]
blockedBy: []
blocks: []
created: "2026-06-03T03:04:18.807Z"
createdBy: "ck:plan"
source: skill
---

# SocketMan v2 Track 1 — UX & Polish

## Overview

Track 1 of the SocketMan v2 roadmap (`docs/development-roadmap.md`): the UX & polish layer over the
shipped v0.1.0 core. Five sequenced phases — Phase 1 builds the notification primitive every later
phase reuses, then export, search/perf, code-gen, and format fidelity. All net-new UX except Phase 5
(behavior-touching format swap — locked by round-trip tests).

**Source:** roadmap `docs/development-roadmap.md`; brainstorm `plans/reports/brainstorm-260602-1456-socketman-tauri-rust-architecture-report.md`.

## Hard Invariants (every phase preserves — do not violate)

- **Secret model locked:** secrets stay Rust-private (resolved on the outbound path); logs/history keep
  templates; `secret_get` is never a Tauri command. **Exports + code-gen emit TEMPLATES (`{{token}}`),
  never resolved secret values.** The frontend resolver already skips secret keys — reuse it.
- **Tauri version-lock:** `@tauri-apps/*` JS must match the Rust `tauri` crate (currently api ^2.11.0 /
  cli ^2.11.2). Any new plugin (Phase 2 dialog/fs) is added on BOTH sides at matched 2.x versions plus a
  `capabilities/` permission entry; **run `npm run e2e` after the add** — it is the IPC-skew detector.
- **CSP gate:** production CSP stays `script-src 'self'` (no `unsafe-eval`/`unsafe-inline`). New npm libs
  (js-yaml, fast-xml-parser, windowing) must not introduce `eval`/`new Function`; `npm run build` runs the
  CSP assertion — keep it green.
- **Windows-first.** No cross-platform work here.

## Phases

| Phase | Name | Status | Deliverable |
|-------|------|--------|-------------|
| 1 | [Notifications & Keychain Feedback](./phase-01-notifications-keychain-feedback.md) | Complete | Toast primitive + `env-editor` surfaces keychain `secretSet`/`secretDelete` failures (no more silent swallow) |
| 2 | [Copy Save Export](./phase-02-copy-save-export.md) | Complete | Copy + Save-to-file for HTTP body & WS frame log via dialog plugin + `export_write` command; exports = templates only |
| 3 | [Search Filter & Virtualization](./phase-03-search-filter-virtualization.md) | Complete | Frame-log filter (dir + text) + windowed rendering; sticky-to-bottom preserved |
| 4 | [Code Generation Export](./phase-04-code-generation-export.md) | Complete | `lib/codegen/` → curl / fetch / wscat snippets from a request/connection (templates) |
| 5 | [Format Fidelity](./phase-05-format-fidelity.md) | Complete | Swap hand-rolled YAML/XML for `js-yaml`/`fast-xml-parser`; `serialize`/`parseFmt` API unchanged |

## Sequencing & Dependencies

- **Order:** 1 → 2 → 3 → 4 → 5. Phase 1 is a hard prerequisite (toasts consumed by 2, 5).
- Phases 3 and 4 are independent of each other (could parallelize) but both are UI-only.
- **Cross-plan:** none. Prior plan `260602-1457-socketman-tauri-rust-workbench` (Phases 1–7) is complete;
  this builds on it, no blocking relationship.
- **Out of scope (Tracks 2–4 + backlog):** binary WS frames, cert pinning, SSE, CI/CD, auto-update,
  cross-platform, MQTT/Socket.IO/Postman import.

## Validation

- Per-phase: `npm run build` (tsc + CSP gate) green; Vitest green; **Phases 2 — `npm run e2e` after plugin add.**
- New tests required: Phase 1 keychain-failure path; Phase 4 codegen round-trip per target; Phase 5 the
  previously-documented lossy cases now pass (delete the "documented lossy" notes from `format-round-trip.test.ts`).

## Validation Log

### Session 1 — 2026-06-03

**Verification Results**
- Claims checked: 8 · Verified: 8 · Failed: 0 · Unverified: 0 · Tier: Full (5 phases)
- Confirmed: `src-tauri/capabilities/default.json` exists; `yaml.ts`/`xml.ts` export
  `yamlStringify/yamlParse`+`xmlStringify/xmlParse`; `resolve-env.ts` has `{skipSecret}` leaving secret
  tokens literal; `lib.rs` uses `tauri::Builder::default()` (`.plugin()` registration valid); `App.tsx`
  has a root mount point (EnvEditor already mounted there); `format-round-trip.test.ts` carries the
  "documented lossless subset" notes Phase 5 tightens; all referenced components exist; `secret-refs.ts`
  exports `secretRefsFor`/`maskSecretTokens`.

**Decisions confirmed**
1. **Phase 3 virtualization** → `@tanstack/react-virtual` (dynamic row measurement for dense mode + sticky-scroll). Hand-rolled rejected.
2. **Phase 2 frame-log export format** → offer BOTH `.json` (structured frame array) and `.txt` (readable log); user picks in the save dialog.
3. **Phase 4 code-gen targets** → curl + fetch + wscat (roadmap set). PowerShell NOT added (kept lean).
4. **Phase 2 save destination** → native `dialog.save()` returns the user-picked path; write there; grant the NARROWEST fs write permission. No fixed exports folder.

### Whole-Plan Consistency Sweep — 2026-06-03
Re-read `plan.md` + all 5 phase files after propagation. No stale terms or contradictions: decisions
propagated to Phase 2 (export format + save scope) and Phase 3 (windowing lib locked). Phase 4 already
matched the confirmed target set. **Zero unresolved contradictions — ready for implementation.**

### Implementation Session — 2026-06-03 (all 5 phases complete)
Executed via `/cook --auto`. All phases green: `npm run build` (tsc + CSP gate + vite) passes;
Vitest 85/85 (was 38 — +47 across toasts, export-file, log-filter, log-stream, codegen, format
round-trip, env-editor); `cargo check` exit 0; **`npm run e2e` 5/5 after the plugin add — no IPC skew**.
Code review: zero Critical/High/Medium findings, ship-ready.

**Deviation (Phase 2, user-approved):** the plan's "fs plugin + narrowest scoped write permission" was
not achievable — Tauri v2's fs plugin denies writes to an arbitrary `dialog.save()` path unless granted a
broad scope (e.g. `$HOME/**`), contradicting "no broad fs". Verified against Tauri v2 docs + discussion
#9195. User chose: add ONLY the dialog plugin (pick path) + a new explicit Rust command
`export_write(path, contents)` (mirrors the existing `storage_save` custom-command pattern). Result: no fs
plugin, no fs scope, IPC allowlist 9→10, the only writable path is the one the user just picked — strictly
narrower than the original plan. Capability added: `dialog:allow-save` only.

**Note:** cargo now HAS network (the prior offline-cache constraint no longer holds) — the dialog plugin
crate fetched + compiled cleanly. js-yaml/fast-xml-parser introduce no CSP `eval` (build gate stayed green).
YAML is now LOSSLESS for JSON-object payloads (js-yaml + JSON_SCHEMA), a tightening over the old
hand-rolled "view-only" parser; XML stays best-effort (inherent data-model losses asserted honestly).
