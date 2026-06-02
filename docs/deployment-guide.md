# SocketMan — Windows Deployment Guide

How to build, package, run, and (optionally) sign the SocketMan desktop app on Windows.

## Prerequisites

- **Node 18+** and npm.
- **Rust 1.78+ (MSVC toolchain)** — install via `rustup`, target `x86_64-pc-windows-msvc`.
- **Visual Studio 2022 Build Tools** with the "Desktop development with C++" workload
  (the MSVC linker + Windows SDK). Required to compile native deps (aws-lc-sys, keyring).
- **WebView2 runtime** — preinstalled on Windows 11. On older Windows, ship the evergreen
  bootstrapper (Tauri can embed it; see "WebView2" below).
- **WiX / NSIS** — Tauri downloads these bundler toolchains automatically on first
  `tauri build`; no manual install needed (network required the first time).

## Build commands

```powershell
# from the repo root
npm install                 # JS deps
npm run build               # tsc --noEmit && vite build  → dist/  (also gates the CSP)
npm run tauri build         # release binary + installers
```

`npm run tauri build` runs `beforeBuildCommand` (`npm run build`) first, then compiles the
Rust binary in `--release` (LTO, opt-level 3) and produces installers.

### Output locations

```
src-tauri/target/release/socketman.exe                         # the raw binary
src-tauri/target/release/bundle/nsis/SocketMan_0.1.0_x64-setup.exe   # NSIS installer
src-tauri/target/release/bundle/msi/SocketMan_0.1.0_x64_en-US.msi    # WiX MSI
```

(Exact file names track `version` in `tauri.conf.json` / `Cargo.toml`.)

## Bundle configuration

Set in `src-tauri/tauri.conf.json` → `bundle`:

- `targets`: `["nsis", "msi"]` — both a `.exe` (NSIS) and `.msi` (WiX) are produced.
- `publisher`, `category` (`DeveloperTool`), `copyright`, `shortDescription`, `longDescription`.
- `windows.nsis.installMode`: `currentUser` — per-user install, **no admin elevation**.
- Icons: the full set under `src-tauri/icons/` (generated via `npm run tauri icon <png>`).

**MSI upgrades:** Tauri derives a stable WiX UpgradeCode from the product identifier
(`com.socketman.app`), so newer MSIs upgrade in place. Bump `version` in BOTH
`tauri.conf.json` and `src-tauri/Cargo.toml` for each release.

## Icons

Regenerate the full icon set from a single source PNG (≥1024×1024) any time the logo changes:

```powershell
npm run tauri icon path\to\socketman-logo.png   # writes src-tauri/icons/*
```

## Code signing (optional, recommended for distribution)

Unsigned installers trigger SmartScreen's "Windows protected your PC / unknown publisher"
prompt. Users can proceed via **More info → Run anyway**, but real distribution should be
signed with an OV/EV code-signing certificate.

To sign, set in `tauri.conf.json` → `bundle.windows`:

```json
"certificateThumbprint": "<your cert SHA-1 thumbprint>",
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com"
```

Then rebuild. (Leave these unset for unsigned dev builds — the default.) You can also sign
the artifacts manually after the fact with `signtool sign /fd sha256 /tr <ts-url> ...`.

## Install smoke test (manual, required before release)

A headless build cannot exercise the GUI — run this on a clean Windows session/VM:

1. Run the NSIS `*-setup.exe` (or the MSI). Confirm branding + icon in the installer.
2. Launch SocketMan. Verify the window title/icon and the SocketMan brand.
3. **WS:** connect to `wss://echo.websocket.events`, send a message, see the echo; toggle
   Disconnect/Connect (reconnect); confirm the heartbeat RTT shows.
4. **HTTP:** send `GET https://postman-echo.com/get` and `POST .../post` with a JSON body;
   verify status pill, headers, body, and timing.
5. **Secrets/persistence:** add an environment, mark a var secret + set a value, reference
   it as `{{token}}` in an Authorization header, connect — confirm it authenticates.
   Restart the app: collections/environments persist; the secret still works without
   re-entry; grep `%APPDATA%\SocketMan\*.json` to confirm **no plaintext secret on disk**.
6. Confirm `%APPDATA%\SocketMan\` holds `collections.json` / `environments.json` /
   `history.json`, and the secret lives only in Windows Credential Manager (search "SocketMan").

## App data + secrets locations (installed context)

- JSON store: `%APPDATA%\com.socketman.app\` (Tauri `app_data_dir`).
- Secrets: **Windows Credential Manager**, service `SocketMan` (via the `keyring` crate).
  Plaintext secret values never touch disk.

## WebView2

Windows 11 ships WebView2. To target older Windows, configure the embedded/online
bootstrapper under `tauri.conf.json` → `bundle.windows.webviewInstallMode`.

## Security notes

- The production CSP (`tauri.conf.json` → `app.security.csp`) is tight: no `unsafe-eval`,
  `script-src 'self'`. `npm run check:csp` (run by `npm run build`) asserts it.
- The installer ships only placeholder starter data — no real tokens are bundled.
- Unsigned binaries are tamper-evident only via user trust; signing is the real mitigation.
