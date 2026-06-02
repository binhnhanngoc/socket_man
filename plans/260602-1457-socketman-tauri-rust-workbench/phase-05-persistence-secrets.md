---
phase: 5
title: "Persistence & Secrets"
status: done
priority: P1
effort: "3-4d"
dependencies: [2, 4]
---

> **Red-team applied (2026-06-02):** `secret_get` is **never registered as a Tauri command** — resolution
> is a private Rust fn (S3). History/frames are assembled & appended **Rust-side** under a mutex, never
> serialized from frontend connection state (S2/F6). Per-file write mutex + unique temp names + atomic
> migration (F6). Keychain account uses a delimiter-safe encoding + key validation + orphan sweep (S7).
> Resolved secret values validated per context before substitution (S8).

# Phase 5: Persistence & Secrets

## Overview

Move durable data off `localStorage` into Rust-owned **JSON files** in the app data dir, and move
secret env-var tokens into the **OS keychain** (`keyring`). The security keystone: **secret
`{{token}}` placeholders resolve Rust-side at send/connect time** so plaintext secrets never enter the
JS heap or any on-disk JSON. Non-secret `{{vars}}` keep resolving in the frontend.

## Key Insights

- Persist **data** (collections, environments, history) as JSON; keep **UI-only prefs** (panel widths,
  density, dark, accent, sidebar collapse) in `localStorage` — they're device-local and trivial.
- Environments stored to disk keep only `{key, secret:bool}` for secret vars — **never the value**.
  The value lives in the keychain. **Account encoding (S7):** do NOT use raw `{envId}:{key}` — `envId` is
  frontend-generated and `key` is user-typed (`design/environments.jsx:110`), so a `:` in a key collides
  namespaces. Use a delimiter-safe scheme (percent-encode each segment, or store one JSON blob per env)
  and **validate `key` against `^[\w.-]+$`** (the resolver's own charset, `design/data.js:168`), rejecting `:`.
- **`secret_get` is NOT a Tauri command (S3).** Registering any `#[tauri::command]` exposes it to all
  webview JS (and any XSS/compromised dep) — there is no "Rust-internal command". Secret reads happen only
  inside a **private** resolution fn called by `ws_connect`/`ws_send`/`http_send`. The env editor writes
  secrets (`secret_set`) and shows a masked placeholder; it never reads them back.
- Resolution must branch: a string with `{{token}}` where `token` is a **secret** var must be resolved
  **inside Rust** right before the frame/header/body leaves for the network. So `ws_send`, `ws_connect`
  config, and `http_send` accept the *unresolved* secret refs + an `envId`, and Rust substitutes from
  keychain. Non-secret tokens are already substituted by the frontend before the call.
- This reshapes the IPC payloads slightly: pass `envId` (or a resolved-non-secret + list of pending
  secret keys) so Rust knows what to pull. Keep it minimal: pass `envId` + the template string; Rust
  resolves only secret tokens it finds, leaving everything else intact.
- **Resolved-value validation (S8):** `resolve_secrets` does a string replace; a secret value with CR/LF
  injected into a **header** = header smuggling on the upgrade, and `/`/`@` in a **URL** can re-point the
  host. Validate per context before substituting: reject control chars (`\r`/`\n`) in header values,
  percent-encode when substituting into URL components, cap length. Reject before `with_header`.
- **History/frames are Rust-owned (S2/F6).** The frontend must NOT serialize its connection state to disk
  — `ConnectionBar` renders a *resolved* URL (`design/workspace.jsx:95`), so frontend state can hold
  resolved secrets. History append is a **Rust** `history_append(entry)` command holding a mutex; it
  stores the **template** (pre-resolution) form. ConnectionBar masks secret tokens (`••••`) in render.
- Migration: on first run, if the JSON store is empty but `localStorage` has data, import once. **Atomic
  order:** write the data file + fsync, THEN write the `migrated` flag; on startup treat "data present"
  (not just the flag) as migrated, so a crash between writes can't double-import.

## Requirements

**Functional**
- JSON store in `%APPDATA%/SocketMan/`: `collections.json`, `environments.json`, `history.json`.
  Commands: `storage_load(name) -> json`, `storage_save(name, json)`.
- Keychain commands (exposed): `secret_set(envId, key, value)`, `secret_delete(envId, key)`. **`secret_get`
  is NOT exposed** — it is a private Rust fn used only by resolution (S3). No command ever returns a
  secret value to JS.
- History command (exposed): `history_append(entry)` + `storage_load("history")` — append is Rust-side so
  it stores templates, never frontend-resolved values (S2/F6).
- Env editor: marking a var secret writes its value to keychain and stores only a `{key, secret:true}`
  ref on disk; editing/saving a secret updates keychain; deleting a var/env purges keychain entries.
- **Rust-side secret resolution**: `ws_connect` (URL + headers), `ws_send` (payload), `http_send`
  (URL + headers + body) resolve `{{secretKey}}` from the active env's keychain entries before sending.
- Collections/environments/history survive restart. Secret values **never** appear in any JSON file.

**Non-functional**
- Atomic-ish writes (temp file + rename) to avoid corruption on crash mid-save.
- Keychain unavailable → clear error surfaced; app still runs with non-secret features.
- No plaintext secret ever logged or written to `history.json` (frame logs must mask resolved secrets,
  or store the pre-resolution template — store the template).

## Architecture

### Rust (`src-tauri/src/storage/`)
```
mod.rs        # StorageManager { file_locks: HashMap<String, tokio::sync::Mutex<()>> } in managed state
store.rs      # JSON load/save in app_data_dir; per-file mutex; atomic write (UNIQUE tmp name + rename)
secrets.rs    # keyring wrapper: set/PRIVATE get/delete; delimiter-safe account encoding; key validation
resolve.rs    # resolve_secrets(template, env_id, secret_keys) -> String; per-context value validation
history.rs    # history_append(entry): load-append-cap(500)-atomic-write UNDER the file mutex (no FE race)
```
- `store.rs` write: `name.<nonce>.tmp` (unique per write, no clobber) → fsync → atomic rename, all under
  the per-file `Mutex` so concurrent `storage_save`/`history_append` to the same file serialize (F6). On
  Windows, rename-over-open can fail (AV lock) → retry-with-backoff a few times, then surface an error.
```rust
// resolve.rs — only secret tokens; leaves non-secret/unknown intact
pub fn resolve_secrets(s: &str, env_id: &str, secret_keys: &[String]) -> Result<String, AppError> {
    let mut out = s.to_string();
    for k in secret_keys {
        if out.contains(&format!("{{{{{k}}}}}")) {
            let v = secrets::get(env_id, k)?;            // keychain
            out = out.replace(&format!("{{{{{k}}}}}"), &v);
        }
    }
    Ok(out)
}
```
- `ws_connect`/`ws_send`/`http_send` gain `env_id: Option<String>` + `secret_keys: Vec<String>`
  (the active env's secret var keys) and call the **private** `resolve_secrets` on URL/headers/body/payload.
  `resolve_secrets` validates each resolved value for its target context (S8) before substituting.

### app data dir
Use Tauri path API (`app.path().app_data_dir()`), create dir on first run. JSON pretty-printed for
diffability.

### Frontend changes
- `use-collections` / `use-environments` switch their persistence from `localStorage` to
  `transport.storageSave/Load` (add these to the `Transport` interface + both impls; mock uses an
  in-memory/`localStorage`-backed shim so tests stay hermetic).
- Env editor: on save, for each secret var call `secret_set` (after validating the key charset); store
  ref-only on disk. Secret vars show a masked placeholder (●●●) + "stored in keychain", write-only
  (overwrite), never read back. On var/env rename or delete → call `secret_delete` for the OLD key (no
  orphans, S7).
- Send/connect paths pass `activeEnvId` + the active env's secret keys to transport so Rust can resolve.
- **History append is Rust-side** (`history_append`), not a frontend serialize of connection state (S2/F6).
  ConnectionBar masks secret `{{token}}` segments in its resolved-URL preview (`••••`).
- One-time migration: if JSON store empty but `localStorage` has data, import then mark migrated (atomic
  order per Key Insights).

## Related Code Files

**Create:** `src-tauri/src/storage/{mod,store,secrets,resolve}.rs`;
`src-tauri/tests/storage_secrets_integration.rs`; `src/transport` additions for storage;
`src/hooks/__tests__/persistence.test.ts`.

**Modify:** `src-tauri/src/lib.rs` (register storage/secret commands), `Cargo.toml` (keyring 4, dirs via
Tauri path), `ws/{connection,request}.rs` + `http/client.rs` (call `resolve_secrets`),
`src/transport/transport.ts` (+`storageLoad/Save`, secret ref types; connect/send/http gain envId+secretKeys),
`src/transport/{tauri,mock}-transport.ts`, `src/hooks/use-collections.ts`, `src/hooks/use-environments.ts`,
`src/components/env-editor.tsx`, `src/hooks/use-connections.ts`, `src/hooks/use-http.ts`.

## Implementation Steps (TDD)

1. **TDD — JSON store (`store.rs` `#[cfg(test)]`):** save→load round-trips arbitrary JSON; partial/corrupt
   file → returns default + no panic; write is atomic (unique temp + rename, no truncated file on
   simulated mid-write); **concurrent saves to the same file serialize via the per-file mutex and don't
   clobber** (spawn N writers, assert final file is one valid writer's output). Implement.
2. **TDD — secrets (`secrets.rs`):** set/get/delete round-trip against the real keychain under a test
   service; missing key → `NoEntry` typed error; delete idempotent; **account encoding test** — a key
   `a:b` does not collide with env-vs-key boundary; **key validation** rejects `:` and out-of-charset keys.
   (`#[ignore]` only if CI lacks a credential store; Windows dev box has one.)
3. **TDD — resolution + validation (`resolve.rs`):** `resolve_secrets("Bearer {{token}}", env, ["token"])`
   pulls from keychain and substitutes; non-secret `{{plant_id}}` left intact; unknown token intact;
   **no partial leak when key absent** (returns error, not half-substituted); **reject a CRLF-laden secret
   substituted into a header value** and **percent-encode** a secret with `/`/`@` into a URL component (S8).
4. **Integration — end-to-end no-leak path:** store a secret, then connect via the in-test echo server
   with the secret in **URL, a header, AND the body** (`Authorization: Bearer {{token}}` + `{{token}}`
   query param + body field). Assert the **server received the real token** in all three, but the value
   appears in NONE of: emitted frames, `history.json`, any IPC response to JS, `AppError`/reason. Frames
   and history store the template form.
5. **Register storage + secret + history commands** (NOT `secret_get`); wire app_data_dir creation +
   per-file mutex state.
6. **Frontend persistence swap:** collections/environments via `storageSave/Load`; history via Rust
   `history_append`; mock shim for tests; localStorage→JSON migration (atomic order; "data present" ⇒
   migrated).
7. **Env editor secret UX:** validate key charset; secret value → keychain on save; masked write-only
   display; rename/delete → `secret_delete` old key (orphan-free). Startup **orphan sweep** reconciles
   keychain entries against `environments.json`.
8. **Wire resolution params** (envId + secret keys) through connect/send/http; ConnectionBar masks secrets.
9. **Gate:** `cargo test` + `npm test` green; manual: set a secret token, connect to a real auth-gated
   `wss://`, restart app, confirm collections/envs persist and secret still works without re-entry; grep
   the JSON files to prove no plaintext secret on disk.

## Todo List

- [ ] JSON store: round-trip + atomic(unique-tmp) + corrupt-file + concurrent-serialize tests, green
- [ ] Keychain set/delete + account-encoding + key-validation tests, green (no `secret_get` command)
- [ ] Resolution+validation tests: no-leak-on-missing, CRLF-in-header rejected, URL percent-encoded
- [ ] E2E no-leak: secret in URL+header+body → server gets real token; absent from frames/history/IPC/errors
- [ ] storage + secret_set/delete + history_append commands registered; per-file mutex state; app_data_dir
- [ ] Frontend persistence → JSON store; history append is Rust-side; atomic localStorage→JSON migration
- [ ] Env editor: key validated, masked write-only, rename/delete purges keychain; startup orphan sweep
- [ ] connect/send/http pass envId+secretKeys; private Rust `resolve_secrets`; ConnectionBar masks secrets
- [ ] Manual: restart persists data; secret survives; grep JSON files shows zero plaintext secrets

## Success Criteria

- [ ] Acceptance: collections/environments survive app restart; secret env vars never stored in
      plaintext on disk (proven by grepping `%APPDATA%/SocketMan/*.json`).
- [ ] Connecting/sending/HTTP with a `{{secretToken}}` works; the plaintext token is never present in
      any IPC payload returned to JS, any frame body, or `history.json`.
- [ ] Deleting a secret var/env removes its keychain entry.
- [ ] `cargo test` + `npm test` green.

## Risk Assessment

- **Secret leaking into history/frames** (the main hazard) → history/frames assembled **Rust-side** with
  the unresolved template; ConnectionBar masks secrets in render; resolution only on the outbound path.
  E2E no-leak test (URL+header+body) asserts this.
- **`secret_get` exposure** → never registered as a command; resolution is a private fn. (S3)
- **Header/URL injection via secret value** → per-context validation before substitution (S8).
- **Keychain absent (Linux/CI)** → typed error + graceful degradation; secret features disabled with a
  clear message, non-secret flows unaffected.
- **Migration double-import / data loss** → atomic order (data+fsync THEN flag); "data present" ⇒ migrated;
  back up localStorage JSON before clearing; never delete source until JSON write confirmed.
- **Concurrent saves / history race corrupting JSON** → per-file `Mutex` + unique temp + atomic rename;
  history load-append-cap-write happens entirely Rust-side under the lock (no frontend read-modify-write).

## Security Considerations

- Keychain account uses a delimiter-safe encoding (not raw `:`-joined) + validated key charset; purge on
  env/var rename+delete; startup orphan sweep reconciles against `environments.json` (S7).
- **No command returns a secret to JS.** `secret_get` is never registered (S3); resolution is a private
  Rust fn. The editor is write-only (overwrite) and shows masked state.
- Resolved secrets live only transiently on the Rust stack during send; not cached, not logged.

## Next Steps

Phase 6 rebrands to SocketMan, replaces demo data with starter content, and wires the History panel to
`history.json` (HTTP responses + WS session summaries).
