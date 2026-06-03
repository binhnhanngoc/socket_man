---
phase: 4
title: "Code Generation Export"
status: complete
priority: P3
effort: "0.5d"
dependencies: [1]
---

# Phase 4: Code Generation Export

## Overview

Generate copy-pastable client snippets — curl / fetch / wscat — from the active HTTP request or WS
connection. Pure frontend; high "workbench" value. Snippets carry templates (`{{token}}`), never resolved
secrets.

## Requirements

- **Functional:** "Copy as ▾" on the HTTP request editor → curl / fetch (JS) for `{method, url, headers, body}`;
  "Copy as ▾" on the WS connection bar/headers pane → wscat (and/or a websocat) line for `{url, headers}`.
- **Non-functional:** snippets use the TEMPLATE form — secret `{{token}}` stays literal (reuse the existing
  secret-skipping resolver; do NOT resolve secrets in JS). Generated curl/fetch must be valid + reproduce the
  request shape. Output via Phase 1 toast + Phase 2 `copyText`.

## Architecture

- New `src/lib/codegen/` — one small serializer per target:
  - `to-curl.ts` (`HttpRequest` → `curl` with `-X`, `-H`, `--data`)
  - `to-fetch.ts` (`HttpRequest` → `fetch(url, {method, headers, body})`)
  - `to-wscat.ts` (`ConnectConfig` → `wscat -c <url>` with `-H` per header)
  - `index.ts` dispatch + shared escaping helpers (shell-quote for curl, JS-string for fetch)
- Consume the same `{url, headers, body}` the editors already hold; run values through the secret-skipping
  resolver so non-secret `{{env}}` vars expand but secrets stay `{{token}}`.
- UI: a small dropdown ("Copy as curl / fetch / wscat") in `http-request-editor` and the WS header/connection
  pane; copies via `copyText` (Phase 2) and toasts (Phase 1).

## Related Code Files

- Create: `src/lib/codegen/to-curl.ts`, `to-fetch.ts`, `to-wscat.ts`, `index.ts`,
  `src/lib/codegen/codegen.test.ts`
- Modify: `src/components/http-request-editor.tsx`, `src/components/connection-bar.tsx`
  (or `ws-tab-panes.tsx` headers pane)
- Read for context: `src/lib/resolve-env.ts`, `src/lib/secret-refs.ts`, `src/transport/transport.ts`

## Implementation Steps

1. Implement the three serializers with correct escaping (shell vs JS string).
2. `index.ts` dispatch: `generate(target, requestOrConfig)`.
3. Wire "Copy as ▾" dropdowns into the HTTP editor + WS pane; resolve non-secret vars, keep secrets literal.
4. Copy via `copyText` + success toast.
5. Vitest: round-trip/shape tests per target — assert a secret token stays `{{token}}` in output; assert curl
   header/body/method correctness; assert special-char escaping (quotes, spaces, newlines).

## Success Criteria

- [ ] curl / fetch / wscat snippets generate from a request/connection and reproduce method, url, headers, body.
- [ ] Secret tokens render as `{{token}}`, never resolved values (test-asserted).
- [ ] Special characters correctly escaped per target.
- [ ] `npm run build` + Vitest green.

## Risk Assessment

- **Escaping bugs** are the main correctness risk — table-test quotes/spaces/newlines per target.
- **Secret leakage** — must run through the skip-secret resolver, not the outbound resolver; test-asserted.
