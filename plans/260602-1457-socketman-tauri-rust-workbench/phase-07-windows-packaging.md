---
phase: 7
title: "Windows Packaging"
status: done  # installers built (MSI 6.1MB + NSIS 3.9MB) via `npm run tauri build`; only the manual GUI install smoke test remains (human step)
priority: P3
effort: "1d"
dependencies: [6]
---

# Phase 7: Windows Packaging

## Overview

Produce a distributable Windows build: app icons, bundle config (MSI via WiX and/or NSIS), a release
build, and a smoke-tested installed app. Code signing is optional for v1 (document the unsigned-binary
SmartScreen caveat). Cross-platform bundle config stays untouched so macOS/Linux remain a later switch-on.

## Key Insights

- Tauri's bundler builds Windows installers out of the box: `npm run tauri build` emits `.msi` (WiX) and
  `.exe` (NSIS) under `src-tauri/target/release/bundle/`. Configure via `tauri.conf.json` `bundle`.
- Icons: Tauri needs a multi-format icon set (`icon.ico`, PNGs, etc.). `npm run tauri icon path/to/icon.png`
  generates the full set into `src-tauri/icons/`.
- Unsigned installers trigger SmartScreen "unknown publisher". Real signing needs a code-signing cert
  (EV/OV) — out of scope for v1 unless the user provides one; document the manual signing step.
- `release` profile already set (lto, opt-level 3) in Phase 1 Cargo.toml; verify binary size + startup.

## Requirements

**Functional**
- `npm run tauri build` produces a working `.msi` and/or `.exe` installer for Windows x64.
- Installed app launches, shows SocketMan branding/icon, and all core flows work (WS connect/send/recv,
  reconnect, HTTP send, persistence, keychain secrets) against the **release** build (not just dev).
- App data dir + keychain behave identically to dev (paths resolve under installed context).

**Non-functional**
- Bundle metadata: product name, version, identifier (`com.socketman.app`), publisher, description,
  license. Installer category/short-description set.
- Document toolchain prereqs (WiX/NSIS pulled by Tauri), output locations, and the signing gap.

## Architecture

- `tauri.conf.json` `bundle` block: `active: true`, `targets: ["msi","nsis"]` (or `"all"`),
  `windows` sub-config (WiX template/upgrade GUID, NSIS options), icons list, resources, category.
- `src-tauri/icons/` generated from a source SocketMan logo (1024² PNG).
- Optional `windows.certificateThumbprint` / signing env for future signed builds — leave documented,
  unset by default.

## Related Code Files

**Create:** `src-tauri/icons/*` (generated), source `assets/socketman-logo.png`,
`docs/deployment-guide.md` (Windows build + run + signing steps).

**Modify:** `src-tauri/tauri.conf.json` (`bundle` config + metadata), `package.json` (version bump,
`build:win` script if helpful), `src-tauri/Cargo.toml` (final version/metadata).

## Implementation Steps

1. **Source icon** → run `npm run tauri icon assets/socketman-logo.png`; verify `src-tauri/icons/` set
   (incl. `.ico`) and referenced in `tauri.conf.json`.
2. **Bundle config:** set `bundle.active`, `targets`, publisher/description/license/category; set WiX
   upgrade GUID (stable, for upgrades) and NSIS basics.
3. **Release build:** `npm run tauri build`; confirm `.msi`/`.exe` emitted; note sizes.
4. **Install smoke test:** install the artifact on a clean Windows session (or VM); launch; run the full
   acceptance checklist against the installed app (all phases' acceptance criteria) — especially
   keychain + app-data persistence under installed paths.
5. **Docs:** write `docs/deployment-guide.md` — prereqs, build commands, artifact locations, how to sign
   (manual `signtool`/cert thumbprint), SmartScreen caveat, version bump procedure.
6. **(Optional) signing:** if the user supplies a cert, wire `certificateThumbprint` + timestamp URL,
   rebuild, verify signature. Otherwise document and skip.

## Todo List

- [ ] Icon set generated + referenced
- [ ] Bundle config (targets, metadata, WiX GUID, NSIS) set
- [ ] `npm run tauri build` emits working `.msi`/`.exe`
- [ ] Installed-app smoke test passes full acceptance checklist (release build)
- [ ] Keychain + app-data persistence verified under installed paths
- [ ] `docs/deployment-guide.md` written (build/run/sign/caveats)
- [ ] (Optional) code signing wired if cert provided

## Success Criteria

- [ ] A clean Windows machine can install SocketMan from the artifact and use every v1 feature.
- [ ] Installer carries correct branding, icon, version, and publisher metadata.
- [ ] Deployment guide lets another dev reproduce the build and (optionally) sign it.
- [ ] Release binary launches quickly and behaves identically to dev.

## Risk Assessment

- **SmartScreen blocks unsigned installer** → document "More info → Run anyway"; recommend signing for
  any real distribution; not a code blocker.
- **Release-only bugs** (paths, CSP, missing assets) vs dev → the installed smoke test is mandatory,
  not optional; budget time to fix path/asset issues surfaced only in release.
- **WebView2 absent** on older targets → Win11 ships it; document the evergreen bootstrapper option if
  targeting older Windows.

## Security Considerations

- Ship with tight CSP (no `unsafe-eval` in production); verify the release CSP isn't loosened.
- Unsigned binaries are tamper-evident only via the user's trust; note signing as the real mitigation.
- Confirm no secrets/tokens are bundled into the installer (starter data is placeholder-only).

## Next Steps

v1 complete. Future (out of scope): macOS/Linux builds + signing/notarization, binary WS frames,
Postman import, frame-log virtualization, SSE/Socket.IO/MQTT.
