# Phase 1: React Prototype → Tauri 2 Desktop App

**Date**: 2026-06-02 14:57
**Severity**: Medium (non-blocking bootstrap friction + 1 high-severity bug found and fixed)
**Component**: UI scaffold, Transport interface, CSP compliance, Tauri + Vite integration
**Status**: Resolved

## What Happened

Ported the static Atomiton Relay prototype (design/*.jsx) into a functioning Tauri 2 + Vite + React + TypeScript desktop application. The entire UI now routes through a `Transport` interface backed by a MOCK implementation; real Rust transport deferred to Phase 2+.

## The Brutal Truth

Bootstrap was rough. Missing Rust toolchain and MSVC C++ Build Tools forced a clean machine setup, but the dependency chain worked once installed. CSP and offline-first requirements killed the prototype's Google Fonts CDN import—self-hosting fonts added friction but was non-negotiable. Most painful: code review caught a High-severity zombie-socket bug that would've shipped silently; disconnecting during the mock's 620ms connect delay was a silent no-op, leaving a leaked tick interval that later resurrected a "connected" state. That's the kind of subtle timing bug that explodes in production.

## Technical Details

**Bootstrap**: Installed Rust toolchain + MSVC C++ Build Tools via winget (user approved). First `cargo build` hit transient crates.io DNS blip; clean retry succeeded.

**Fonts**: Replaced `@import url('https://fonts.googleapis.com/...')` with self-hosted @fontsource packages (Geist, JetBrains Mono, Instrument Serif). Prepended "Variable" family names to font-var definitions; rest of CSS unchanged. CSP enforces `style-src 'self'` — offline-first non-negotiable for desktop.

**Security**: Built `resolveEnv(str, env, {skipSecret})` in src/lib/resolve-env.ts. Vars marked `secret:true` remain literal `{{token}}` in JS heap, never substituted client-side; Rust substitutes later (Phase 5). All callsites pass `skipSecret` flag.

**State**: Used single coordinating `use-workspace-store` (F15) instead of 5 cross-importing hooks because disconnect + send + reconnect ops mutate urls + conns + msgs atomically. Documented exception to the 200-LOC rule (167 lines justified by single-source-of-truth requirement).

**Bug Fix**: Code review flagged High-severity disconnect race. Pending connect timer was never cancelled; if user disconnected during 620ms connect delay, the timer fired anyway, resurrecting a zombie "connected" socket with a leaked tick interval. Fixed by: (1) making pending connect cancellable, (2) always emitting close frame on cancel, (3) added fake-timer regression test covering the race.

## Lessons Learned

1. **Timing bugs in mocks are insidious.** A 620ms mock delay exposed the race because it was long enough to race with user action. Shorten mocks in tests or add explicit cancellation assertions.
2. **CSP + offline-first is non-negotiable for security.** Bootstrap friction is worth it; self-hosting fonts is the only path.
3. **Single state coordinator beats distributed hooks.** Atomic ops on shared state need a single source of truth, not composition.
4. **Code review catches what tests miss.** The zombie-socket bug would pass unit tests because each test ran in isolation; the race only surfaces under user-driven state changes.

## Next Steps

- **Phase 2**: Implement real Rust WebSocket engine + IPC Channel streaming to replace MOCK.
- **Gate checks**: All passing—`npm run build` (tsc strict + vite), `cargo build`, 29 vitest tests, CSP assertion, no globals.
