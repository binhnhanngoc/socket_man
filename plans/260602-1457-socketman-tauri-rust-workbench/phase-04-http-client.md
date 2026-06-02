---
phase: 4
title: "HTTP Client"
status: pending
priority: P2
effort: "2d"
dependencies: [1]
---

> **Red-team applied (2026-06-02):** needs the **Phase 1.5 backend skeleton** (`error.rs`/`AppError`,
> `lib.rs` registry, `Cargo.toml` base) — it is NOT independent of that seam, and shares `lib.rs`/
> `Cargo.toml`/transport TS with Phase 2 (coordinate, don't free-for-all, F16). Single strict reqwest
> client — dual insecure-TLS HTTP path CUT (F17). Secret tokens NOT resolved in JS (F1). TTFB out of
> scope (F7-adjacent). Test infra trimmed to a single echo route (F26).

# Phase 4: HTTP Client

## Overview

Replace the simulated `HttpWorkspace` with a real `http_send` Rust command (reqwest) and build out the
HTTP request/response UI: method + URL + headers + body editor, and a response view showing
status/headers/body/timing. The `http/` module is disjoint from `ws/`, so it can be built **alongside**
Phase 2 — but it depends on the **Phase 1.5 backend skeleton** (`AppError`, the `lib.rs` command registry,
the `Cargo.toml` base) and edits the same shared files as Phase 2 (`lib.rs`, `Cargo.toml`, the four
transport TS files). "Parallel" means disjoint modules + the shared registry convention (one handler per
line, alphabetized), NOT conflict-free independence.

## Key Insights

- `Transport.httpSend` already exists from Phase 1 (mock returns canned data). This phase implements
  the **Rust + tauri** side and fleshes out the **UI** that the prototype only stubbed.
- reqwest with `rustls-tls-native-roots` matches the WS TLS stack (one TLS story). **One strict client
  only** — the dual-client/`danger_accept_invalid_certs` HTTP insecure path is CUT for v1 (F17): the
  brainstorm scoped the self-signed toggle to `wss://` only, and an insecure HTTP path is an unrequested
  footgun. If self-signed HTTPS is ever needed, add it as a scoped follow-up.
- Timing: wrap `Instant::now()` around send→body-read for total. **TTFB is OUT OF SCOPE for v1** (F7) —
  the prototype shows a single timing number (`design/workspace.jsx:187`); total elapsed is the contract.
- The prototype `HttpWorkspace` is a static demo (hardcoded GET/POST bodies). Build the real editor:
  tabs Body/Headers/Auth, method picker, send, response panel — reusing existing CSS classes
  (`http-ws`, `conn-bar`, `http-tabs`, `http-panel`, `JsonView`).

## Requirements

**Functional**
- `http_send(request) -> response`: method (GET/POST/PUT/PATCH/DELETE), URL, custom headers, optional
  body; returns status, statusText, response headers, body (text), timingMs, sizeBytes.
- HTTP item editor: edit URL, method, request headers (KV rows), request body (with format switch
  reusing the formats module); `{{var}}` resolution for URL/headers/body (non-secret in frontend;
  secret resolution Rust-side lands in Phase 5).
- Response view: status pill (color by 2xx/4xx/5xx), timing + size meta, headers list, pretty body via
  `FormatView` (auto-detect JSON vs text by content-type).
- Errors (DNS, refused, TLS, timeout) surface as a readable error state, not a crash.

**Non-functional**
- 30s default timeout (configurable later); request runs off the IPC thread.
- HTTP response body capped/streamed sensibly to avoid huge-payload memory spikes (cap + note).

## Architecture

### Rust (`src-tauri/src/http/`)
```
mod.rs
client.rs   # shared reqwest::Client (built once, stored in managed state or OnceCell)
types.rs    # HttpRequest, HttpResponse (mirror transport.ts)
```
```rust
#[tauri::command]
async fn http_send(req: HttpRequest, state: State<'_, HttpClient>) -> Result<HttpResponse, AppError> {
    let start = Instant::now();
    let mut rb = state.0.request(req.method.parse()?, &req.url);
    for (k,v) in &req.headers { rb = rb.header(k, v); }
    if let Some(b) = req.body { rb = rb.body(b); }
    let resp = rb.send().await?;
    let status = resp.status(); let headers = clone_headers(&resp);
    let body = resp.text().await?;            // buffered; cap upstream if needed
    Ok(HttpResponse { status: status.as_u16(), status_text, headers, size_bytes: body.len(), body,
                      timing_ms: start.elapsed().as_millis() as u64 })
}
```

### Frontend (`src/components/http-workspace.tsx` rebuild + helpers)
- `http-workspace.tsx` → real stateful component: method select, URL input (with resolved-var preview
  like ConnectionBar), tabs, send button, response panel.
- `http-request-editor.tsx` (headers KV + body w/ format seg) and `http-response-view.tsx` (status/meta/
  headers/body) split out to respect 200-LOC rule.
- `use-http.ts` hook: holds per-item request draft + last response + loading/error; calls
  `transport.httpSend`.

## Related Code Files

**Create:** `src-tauri/src/http/{mod,client,types}.rs`; `src-tauri/tests/http_integration.rs`;
`src/components/http-request-editor.tsx`, `src/components/http-response-view.tsx`; `src/hooks/use-http.ts`;
`src/hooks/__tests__/use-http.test.ts`.

**Modify:** `src-tauri/src/lib.rs` (register `http_send`, manage `HttpClient`), `Cargo.toml`
(reqwest 0.13 `rustls-tls-native-roots`), `src/transport/transport.ts` (already has Http types — confirm),
`src/transport/tauri-transport.ts` (implement `httpSend`), `src/transport/mock-transport.ts` (keep canned
impl for tests), `src/components/http-workspace.tsx` (rebuild).

## Implementation Steps (TDD)

1. **Add reqwest** to `Cargo.toml`; build a shared `Client` in managed state.
2. **TDD — integration (`tests/http_integration.rs`, trimmed F26):** a **single** local echo route
   (axum/hyper) reflecting method + headers + body as JSON. Assert `http_send` returns correct status,
   captured request headers, body, and `sizeBytes`. Cover 404/timing/non-JSON by parameterizing the one
   route (status query param, optional sleep, content-type switch) or against a public endpoint — don't
   build four bespoke routes. Implement `http_send` until green.
3. **TDD — error mapping:** test connection-refused / bad-URL / timeout map to `AppError` strings.
4. **TDD — `use-http` hook test** (Vitest, mock transport): loading→success and loading→error
   transitions; response stored per item.
5. **Build UI:** rebuild `http-workspace.tsx` + split editor/response components; wire `use-http`;
   reuse formats module + CSS classes; status pill colors.
6. **Var resolution (F1):** apply `resolveEnv(…, { skipSecret:true })` to URL/headers/body before send —
   non-secret vars only; secret `{{token}}` placeholders stay LITERAL and resolve Rust-side in Phase 5.
   Add a test asserting a secret-var token survives frontend resolution unresolved (no plaintext in the
   `HttpRequest` handed to `http_send`).
7. **Manual E2E:** real GET (`https://httpbin.org/get` or `https://postman-echo.com/get`) + POST with
   JSON body + custom Authorization; view status/headers/body/timing.
8. **Gate:** `cargo test` + `npm test` green; manual E2E passes.

## Todo List

- [ ] reqwest added; shared Client in managed state
- [ ] HTTP integration test (echo/404/timing/non-JSON) written first, green
- [ ] Error-mapping tests green (refused/bad-url/timeout)
- [ ] `use-http` hook tests (loading/success/error) green
- [ ] `http_send` command registered
- [ ] HttpWorkspace rebuilt: method/URL/headers/body editor + response view
- [ ] Var resolution (`skipSecret`) applied to URL/headers/body; secret token stays literal (tested)
- [ ] Single strict reqwest client (no insecure HTTP path)
- [ ] Manual E2E GET + POST with custom header passes

## Success Criteria

- [ ] Acceptance: send a real HTTP GET/POST and view status, headers, body, and timing.
- [ ] 404 / network error / timeout render a clear error state (no crash).
- [ ] Response body pretty-prints JSON via existing FormatView; non-JSON shows as text.
- [ ] `cargo test` + `npm test` green; UI uses prototype CSS (visual continuity).

## Risk Assessment

- **Huge response bodies** → cap buffered body (e.g. warn/truncate >N MB) with a note; full streaming
  deferred.
- **Method/header parse errors** (invalid header name) → validate + map to readable error.
- **Content-type detection** wrong → fall back to Text view; let user switch format manually.

## Security Considerations

- Secret env tokens are NOT resolved in JS (`skipSecret`); they resolve Rust-side in Phase 5. A raw
  user-typed header value crosses IPC in-process (acceptable).
- **No insecure HTTP TLS path in v1 (F17):** one strict reqwest client with native roots. Self-signed
  HTTPS is explicitly out of scope (the WS self-signed toggle does not extend to HTTP).

## Next Steps

Phase 5 persists collections/history/environments to JSON and moves secret resolution Rust-side; HTTP
history entries feed the History panel in Phase 6.
