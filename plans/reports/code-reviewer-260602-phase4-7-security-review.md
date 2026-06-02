# Code Review — SocketMan Phase 4–7 Security Keystone

Date: 2026-06-02
Reviewer: code-reviewer
Scope: Phase 4–7 (HTTP transport, persistence, secrets, WS refactor)
Mode: full security/correctness/regression review (no git diff — files read directly)

## Scope

Rust: commands.rs, storage/{resolve,secrets,store,history,mod}.rs, http/client.rs,
ws/{connection,manager,reconnect,types,request,tls,heartbeat,cancel}.rs, error.rs, lib.rs
Frontend: lib/{secret-refs,resolve-env,history-log}.ts, hooks/{use-http,use-workspace-store}.ts,
env-editor.tsx, transport/{transport,tauri-transport,mock-transport}.ts

## Overall Assessment

Strong. The secret keystone holds: plaintext secrets are read only Rust-side in
`storage::secrets::get` (private, never a command), resolved only on the outbound path
in `resolve_secrets`, and the registry confirms `secret_get` is absent. All 5 acceptance
criteria are met as designed. No Critical findings. The issues below are hardening/edge
cases — none break the keystone.

## Acceptance Criteria Verification

1. **Plaintext never crosses IPC / frame / history / disk / AppError** — VERIFIED.
   - Frontend resolves with `{ skipSecret: true }` (resolve-env.ts:37); secret tokens stay
     literal `{{key}}` in JS. Only KEYS travel (secret-refs.ts:11, SecretRefs type).
   - Rust resolves at the boundary (commands.rs:41-48,71,86-94). Out-frame logs the TEMPLATE
     (`log_text`), never the wire value (connection.rs:53,205-209; manager.rs:72 always uses
     `Outbound::text(wire, log)`).
   - history is template-form (use-http.ts:64-70, use-workspace-store.ts:248-249) and Rust-side
     append never sees resolved values (history.rs).
   - env-editor strips plaintext before persist (env-editor.tsx:69); secret value goes only to
     keychain (secretSet). AppError carries only Display of fs/keyring/reqwest errors (error.rs).
2. **secret_get never a command** — VERIFIED. Absent from `generate_handler!` (lib.rs:31-41);
   `secrets::get` is `pub` (crate) but not `#[tauri::command]` (secrets.rs:58). No `secretGet`
   in the Transport interface (transport.ts:89-92).
3. **No WS engine regression** — VERIFIED. Single-task `select!` intact (connection.rs:151-227);
   `rx: &mut` borrow preserves rx/connId/tx across socket swap (connection.rs:133, manager.rs
   hoist 51-53). Cancel arm instant on live socket + interruptible backoff (reconnect.rs:61-67,
   109-115). Heartbeat one-bit state machine unchanged. Stable connId via atomic counter.
   Outbound refactor adds `log_text` only; wire path unchanged.
4. **HTTP errors readable, URL stripped** — VERIFIED. `without_url()` at map_reqwest_err
   (client.rs:41); test asserts `127.0.0.1:1` absent (client.rs:144). Timeout/connect/builder/
   request kinds mapped to readable strings.
5. **Per-context validation blocks CRLF + host re-point** — VERIFIED. Header rejects CR/LF
   (resolve.rs:49-52); URL percent-encodes reserved chars incl `/ @ : ? # &` (resolve.rs:62-71).
   Tests cover both (resolve.rs:104-121).

## Critical Issues

None.

## High Priority

### H1 — URL-resolved secret can ride a WS connect error back to the webview
`ws/reconnect.rs:96-98` — on a `connect_ws` failure the error is `scrub(e.to_string(), &cfg)`,
but `scrub` (reconnect.rs:144-151) only replaces **sensitive header VALUES**. A secret resolved
into the WS **URL** (commands.rs:41, `SecretCtx::Url`) is NOT scrubbed. The error comes from
`connect_async`/tungstenite (tls.rs:108 `AppError::Connect(e.to_string())`), which — unlike the
reqwest HTTP path — has no `without_url()` equivalent. tungstenite handshake/IO errors can embed
the request URI (incl. path/query where a URL secret lands).

Threat-model check: the secret is percent-encoded, so it survives as e.g. `%2Fb%40host` — still
recoverable plaintext if echoed. This is a real (if narrow) leak path that the HTTP side explicitly
defends against but the WS side does not.

Fix: extend `scrub` to also strip the resolved URL secret. Simplest: pass the set of resolved
secret values (or scrub `cfg.url`'s post-resolution secret substrings). Concretely, have
`ws_connect` capture the resolved secret values and scrub them alongside header values, OR scrub
the whole `cfg.url` token region. Minimal patch — also replace any `cfg.url` occurrence:
```rust
fn scrub(mut s: String, cfg: &ConnectConfig, resolved_url_secrets: &[String]) -> String {
    for (name, value) in &cfg.headers {
        if is_sensitive_header(name) && !value.is_empty() { s = s.replace(value.as_str(), "***"); }
    }
    for v in resolved_url_secrets { if !v.is_empty() { s = s.replace(v.as_str(), "***"); } }
    s
}
```
`ws_connect` would collect the resolved URL secret values when it resolves them and thread them
into the supervisor. (Header secrets already covered because resolved values land in cfg.headers.)

## Medium Priority

### M1 — `scrub` substring replace can mangle short / non-secret-looking values
`ws/reconnect.rs:144-151` — `s.replace(value.as_str(), "***")` is an unbounded substring replace.
A short or common header value (e.g. a 1–2 char token, or a value equal to a substring of the
host/reason) would over-redact the error text. Low security impact (over-redaction is safe), but
it can produce confusing reasons like `***connection ***ed`. Acceptable for v1; consider gating on
a minimum length or word boundary. Not blocking.

### M2 — env-editor: keychain write failure is silently swallowed; later resolve hard-fails the send
`env-editor.tsx:62-66` — if `secretSet` throws (keychain unavailable), the var is still persisted
as a secret ref with empty value. At send/connect time `resolve_secrets` → `secrets::get` returns
`AppError::Secret("no secret stored...")` and the WHOLE request fails (correct: no partial sub).
The UX gap: the user got no signal at save time that the secret wasn't stored. Functionally safe
(fails closed, no leak). Recommend surfacing the save-time keychain error to the user instead of
the empty `catch {}`. Not a security defect.

### M3 — `resolve_secrets` re-scans the string per key (O(keys × len))
`storage/resolve.rs:30-41` — for each secret key it does `s.contains(token)` then a full
`s.replace`. With many keys this is O(n·m). Inputs are tiny (URL/header/body) and key counts are
small, so this is fine in practice — noting only for awareness, not action (YAGNI).

## Low Priority

### L1 — `validate_value` length cap (8192) is silent vs key cap inconsistency
`resolve.rs:45` caps secret value at 8192 bytes; `secrets.rs` caps key at 256. Both fine; the
8192 value cap is post-fetch, so an over-long stored secret errors at resolve time (fails closed,
good). No action.

### L2 — `collect_headers` joins duplicate response headers with ", "
`http/client.rs:92-104` — folding multiple `set-cookie` into one comma-joined value is
technically lossy for cookies (cookies legitimately contain commas in `Expires`). Display-only in
a workbench; acceptable. Note for future if cookie inspection matters.

### L3 — store tmp-file uniqueness relies on `process::id()` + atomic nonce
`storage/store.rs:55-56` — unique within a process; two SocketMan processes sharing the app data
dir is not a supported scenario (single desktop app). Fine. The per-file mutex (mod.rs:36-39)
correctly serializes same-name writers; tests cover concurrency (store.rs:122, history.rs:59).

## Edge Cases Checked (no defect)

- Partial substitution: `resolve_secrets` fetches+validates ALL before any splice (resolve.rs:29-41)
  → a missing/invalid key returns Err with zero substitution. Test confirms (resolve.rs:94-102). PASS.
- `secret_keys` empty / env absent: commands guard `!keys.is_empty()` and tuple-match (commands.rs:39,
  84,139-142) → payload passes through untouched. PASS.
- Account encoding collision: env_id and key both pct-encoded, single `:` boundary; `:` rejected in
  keys upstream (secrets.rs:43-45, validate_key). Test confirms (secrets.rs:90-100). PASS.
- Path traversal: `validate_name` allows only `[A-Za-z0-9_-]`, blocks `..`/`/` (store.rs:20-29).
  Test confirms (store.rs:114-120). PASS.
- WS cancel-vs-await race: `Cancel::cancelled` enables Notified before re-checking flag
  (cancel.rs:45-58). Test confirms. PASS.
- connectedAt reset on heartbeat: `status_rtt` leaves `connected_at: None`; frontend preserves
  existing connectedAt on non-fresh status (connection.rs:258-262, use-workspace-store.ts:225-230). PASS.
- Duplicated WS item aliasing live socket: connIdMap keyed by item id; new id has no entry
  (use-workspace-store.ts:316-319). PASS.
- WS send always serializes to "json" (use-workspace-store.ts:256): intentional — server is JSON,
  Composer parses draft then re-serializes; format is a display concern. NOT a bug.
- Debug redaction of ConnectConfig masks sensitive header values (types.rs:79-94). PASS.

## Recommended Actions

1. **H1**: scrub resolved URL secret values out of WS connect/drop error strings (close the only
   real residual leak path; mirrors the HTTP `without_url` guarantee). Add a test asserting a
   `{{secret}}`-in-URL connect failure does not echo the resolved value.
2. **M2**: surface keychain `secretSet` failure at save time (don't swallow) so the user learns the
   secret wasn't stored before a send fails.
3. M1/L2: optional hardening, non-blocking.

## Metrics

- Rust tests: 56 pass (per task). Frontend Vitest: 38 pass. tsc clean. Release + installers OK.
- Type coverage: high (explicit types throughout; no `any` seen on the secret path).
- Linting issues: none observed.

## Unresolved Questions

1. **H1 severity**: does tungstenite's `connect_async` error Display actually embed the request
   URI in this version? If empirically it never does, H1 drops to Low. Recommend a quick test
   (resolve a secret into a `wss://` path, point at a dead host, assert the resolved value is
   absent from the emitted reason) to settle it definitively rather than relying on the assumption.
