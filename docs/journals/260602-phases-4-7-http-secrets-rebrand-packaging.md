# Journal — Phases 4–7: HTTP, Persistence/Secrets, Rebrand/History, Packaging

**Date:** 2026-06-02 · **Scope:** `/cook --auto plans/260602-1457-socketman-tauri-rust-workbench/ all next phases`

## What shipped

- **P4 HTTP client.** `reqwest` 0.13.4 with `rustls` + `rustls-platform-verifier` (Windows cert store, same provider as the WS verifier). `http_send` command with URL-stripped error mapping + 16 MiB body cap. Frontend `use-http` hook + rebuilt `HttpWorkspace` (request-editor / response-view split). Tests: 6 integration (raw tokio echo server) + 3 error-mapping + 3 hook.
- **P5 Persistence & secrets.** Rust `storage/` module: atomic JSON store (unique-tmp + fsync + rename, per-file mutex, corrupt-tolerant), keyring-3 secret store (`secret_set`/`secret_delete` commands, private `get`), `resolve_secrets` (Rust-only outbound, per-context validation), Rust-side `history_append`. `Outbound` envelope keeps resolved secrets out of the WS frame log. Frontend threads `{envId, secretKeys}`, env-editor writes secrets to keychain + strips plaintext, collections/envs hydrate from the JSON store.
- **P6 Rebrand & history.** Atomiton/Relay → SocketMan (only `relay.*` migration keys kept); neutral starter data (echo.websocket.events / postman-echo, placeholder secret); History panel over persisted `history.json`.
- **P7 Packaging.** Bundle metadata + CSP build gate + `deployment-guide.md`; `npm run tauri build` produced MSI (6.1 MB) + NSIS setup.exe (3.9 MB).

## Decisions & surprises

- **keyring 4 → 3 (surfaced to user).** The pinned keyring 4.0.1 is a `keyring-core` rewrite with a changed API and no soak. As a library change to the security keystone, it was surfaced — user chose keyring 3.x (the stable `Entry` API the plan assumed).
- **reqwest TLS feature.** `rustls-tls-native-roots` doesn't exist in 0.13.4; `rustls` (→ `rustls-platform-verifier`, aws-lc-rs) is the native-roots path and matches the existing WS provider.
- **Intermittent network.** crates.io access flapped; the release binary compiles fully offline (all deps cached), and a one-time online `cargo metadata` cached the unused `hyper-tls` index entry that `tauri build` resolves.
- **H1 (from code review) fixed.** A secret resolved into a WS URL wasn't scrubbed from connect errors (`scrub` only masked header values). Fix: collect resolved secret values (`resolve_secrets_into` → `ConnectConfig.redact`, `#[serde(skip)]`) and mask them all in `scrub`. Regression test added.

## State

- Rust: 57 tests green (incl. real Windows-keychain round-trip, storage E2E no-leak, URL-secret-no-leak). Frontend: 38 Vitest green. tsc clean. Installers built.
- **Pending (human/GUI step):** manual install smoke test of the packaged app (the only Phase 7 acceptance item that can't run headlessly).

## Open items (non-blocking)

- M2 (review): env-editor swallows a `secretSet` keychain failure silently (fails closed — no leak — but no save-time signal). Consider a user-visible warning.
- Repo is not under git, so no commit was made this session.
