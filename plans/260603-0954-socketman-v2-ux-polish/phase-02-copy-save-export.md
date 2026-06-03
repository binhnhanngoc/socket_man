---
phase: 2
title: "Copy Save Export"
status: complete
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 2: Copy Save Export

## Overview

Add Copy-to-clipboard and Save-to-file for the HTTP response body and the WS frame log. Introduces the
first new Tauri plugins (dialog + fs) — the version-lock + capabilities + e2e ritual applies here.

## Requirements

<!-- Updated: Validation Session 1 - export = both .json + .txt; save via dialog.save() chosen path + narrowest fs perm -->
- **Functional:** "Copy" + "Save…" on the HTTP response body (`http-response-view`); "Export log" on the WS
  frame log (`log-stream` / `ws-workspace`). Save uses native `dialog.save()` → write to the user-picked path.
  Frame-log export serializes the visible frames (respecting active filter from Phase 3 if present) and offers
  BOTH `.json` (structured frame array: dir/kind/ts/size/body templates) and `.txt` (readable log lines) —
  chosen via the save dialog's extension/filter.
- **Non-functional:** **exports contain TEMPLATES only — never resolved secret values** (frame log already
  stores template bodies Rust-side; HTTP response body is server-returned, safe). Copy uses the browser
  Clipboard API where available, else a Tauri fallback. Success/failure routed through Phase 1 toasts.

## Architecture

- **Plugins (BOTH sides, version-matched to tauri 2.11.x):**
  - npm: `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs` (`^2`).
  - Rust `Cargo.toml`: `tauri-plugin-dialog`, `tauri-plugin-fs` (`2`); register `.plugin(...)` in `lib.rs`.
  - `src-tauri/capabilities/default.json`: add `dialog:allow-save` + the NARROWEST fs write permission that
    lets the renderer write the dialog-returned path (`fs:allow-write-text-file`, scoped). No broad
    `fs:default`. No fixed exports folder — destination is always the user-picked path.
- **Transport seam:** add a thin `exportSave(suggestedName, contents)` helper. Prefer the Tauri plugin path
  in `tauri-transport`; in `mock-transport` (browser/Vitest) fall back to a Blob + `<a download>` so the
  feature degrades gracefully and tests stay hermetic. Keep the `Transport` interface honest (mirror in
  both impls) — do NOT smuggle plugin calls directly into components.
- **UI:** small "Copy"/"Save…" buttons in `http-response-view` body head and a "Export" control in the WS
  log pane head.

## Related Code Files

- Create: `src/lib/export-file.ts` (clipboard + save dispatch over transport)
- Modify: `src/components/http-response-view.tsx`, `src/components/log-stream.tsx`,
  `src/components/ws-workspace.tsx`, `src/transport/transport.ts` (interface), `src/transport/tauri-transport.ts`,
  `src/transport/mock-transport.ts`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`,
  `src-tauri/capabilities/default.json`, `package.json`
- Verify: `src-tauri/Cargo.lock` committed after add

## Implementation Steps

1. Add npm dialog/fs plugins; add Rust crates + `.plugin()` registration; add capability permissions.
2. `export-file.ts`: `copyText(s)` (Clipboard API → toast) and `saveText(suggestedName, s)` (transport export).
3. Add `exportSave` to the `Transport` interface; implement in `tauri-transport` (plugin) and `mock-transport`
   (Blob download).
4. Wire Copy/Save buttons into `http-response-view`; wire Export into the WS log pane.
5. Route all outcomes through Phase 1 toasts.
6. **Run `npm run e2e`** to confirm no IPC/version skew from the plugin add; then `npm run build` + Vitest.

## Success Criteria

- [ ] HTTP body + frame log copy to clipboard and save to a chosen file in the packaged app.
- [ ] Exported content contains templates only (no resolved secrets); verify against a frame log built from a
      secret-bearing send.
- [ ] Mock transport (Vitest/browser) uses the Blob fallback — tests stay hermetic.
- [ ] `npm run e2e` green after plugin add; `npm run build` + Vitest green; `Cargo.lock` committed.

## Risk Assessment

- **Version skew (highest risk):** new Tauri plugins are the classic skew source — pin to 2.x matching the
  tauri crate; e2e is the gate. If e2e breaks, align versions before proceeding.
- **Capability over-scoping:** grant the narrowest fs write permission; avoid broad `fs:default`.
- **Secret leakage via export:** assert templates-only with a test on a secret-bearing log.
