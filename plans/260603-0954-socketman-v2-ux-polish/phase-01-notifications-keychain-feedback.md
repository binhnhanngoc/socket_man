---
phase: 1
title: "Notifications & Keychain Feedback"
status: complete
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Notifications & Keychain Feedback

## Overview

Introduce a lightweight toast/notification primitive (none exists today) and use it to surface keychain
`secretSet` / `secretDelete` failures that `env-editor` currently swallows silently. Foundation phase —
Phases 2 and 5 consume the same toast API.

## Requirements

- **Functional:** a `useToasts` hook + a single toast-host renderer mounted near the app root; API to push
  `success` / `error` / `info` toasts that auto-dismiss and are manually dismissable. `env-editor.save()`
  collects keychain write/delete failures and reports them via an error toast naming the failed key(s);
  successful save shows a confirmation.
- **Non-functional:** fails closed — a keychain failure must NOT block the rest of the save or leak a secret
  value; toast text must never contain secret values (key names only). No new deps. <200 LOC per file.

## Architecture

- New `src/hooks/use-toasts.ts` — module-level store (simple subscribe/emit, no context-provider ceremony)
  so any module (hooks, components) can `pushToast(...)` and the host re-renders. Mirrors the existing
  module-singleton style of `src/transport/index.ts`.
- New `src/components/toast-host.tsx` — fixed-position stack; renders active toasts; dismiss button.
- Mount `<ToastHost/>` once in `src/App.tsx`.
- `env-editor.tsx` `save()` (currently swallows at lines 53–56 and 63–66): accumulate failed keys into a
  local array inside the existing try/catch blocks, then after the reconcile loop push one error toast if
  non-empty, else a success toast. Keep the existing fail-closed behavior (var still persists as a ref).

## Related Code Files

- Create: `src/hooks/use-toasts.ts`, `src/components/toast-host.tsx`, `src/hooks/use-toasts.test.ts`
- Modify: `src/App.tsx` (mount host), `src/components/env-editor.tsx` (collect + report failures),
  `src/styles/app.css` (toast styles, reuse existing color tokens)

## Implementation Steps

1. Build `use-toasts.ts`: `pushToast({kind, message})`, `dismiss(id)`, `useToasts()` subscriber returning
   the active list. Auto-dismiss via timeout stored per toast.
2. Build `toast-host.tsx` consuming `useToasts()`; render stack with kind-colored accent + dismiss `IconX`.
3. Mount `<ToastHost/>` in `App.tsx`.
4. Refactor `env-editor.save()`: collect `failedKeys: string[]` in the two catch blocks; after loops, if
   `failedKeys.length` push `error` toast (`"Couldn't save secret(s) to keychain: <keys>"`), else `success`.
5. Add toast CSS in `app.css` using existing `--leaf`/`--rust`/`--solar` tokens.
6. Vitest: `use-toasts.test.ts` (push/auto-dismiss/manual-dismiss) + extend an env-editor test to assert an
   error toast fires when `transport.secretSet` rejects (mock transport throws).

## Success Criteria

- [ ] Keychain `secretSet`/`secretDelete` failure shows a visible error toast naming the key; save still
      completes fails-closed (no leak, var persists as ref).
- [ ] Successful secret save shows a confirmation toast.
- [ ] Toast text never contains a secret value.
- [ ] `use-toasts` unit test + env-editor failure-path test green; `npm run build` green.

## Risk Assessment

- **Stale-closure async toasts:** push from async `save()` — keep store module-level (not component state)
  to avoid stale refs, matching the codebase's `useRef`/singleton patterns.
- **Double-mount:** ensure `<ToastHost/>` mounted exactly once.
