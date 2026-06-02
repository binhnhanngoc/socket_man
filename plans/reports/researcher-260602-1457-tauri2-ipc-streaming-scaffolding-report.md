# Tauri 2 Frontend↔Backend Integration: Technical Reference

**Scope**: Windows-first desktop app (Tauri 2 stable, Vite+React+TypeScript frontend, Rust backend with WS/HTTP).
**Date**: 2026-06-02 | **Source credibility**: Official Tauri v2 docs + production case studies from 2026.

---

## 1. SCAFFOLDING & PROJECT SETUP

### Create Project
```bash
npm create tauri-app@latest socket-man -- --template react
# Follow prompts: TypeScript, pnpm/npm, React
```

### Directory Structure Post-Scaffold
```
socket-man/
├── src/                          # React + TypeScript frontend
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Window setup, app lifecycle
│   │   ├── lib.rs                # Command handlers, event emitters
│   │   └── state.rs              # Managed state (optional modularization)
│   ├── Cargo.toml                # Rust deps
│   └── tauri.conf.json           # IPC + window config
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Minimal Cargo.toml (src-tauri/)
```toml
[package]
name = "socket_man"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2.11", features = ["shell-all"] }  # Adjust features per needs
tokio = { version = "1", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1"

[build-dependencies]
tauri-build = "2.11"

[profile.release]
opt-level = 3
lto = true
```

**Stable versions (2026)**:
- `tauri@2.11.2` (latest stable v2)
- `@tauri-apps/api@2.x` (TS)
- `@tauri-apps/cli@2.11.2` (local install via package.json)

### Minimal tauri.conf.json (Windows-only)
```json
{
  "productName": "SocketMan",
  "version": "0.1.0",
  "identifier": "com.socketman.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "SocketMan",
        "label": "main",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    }
  }
}
```

### Dev vs Build Commands
**Dev** (npm run dev):
- Vite dev server runs on `http://localhost:5173` (hot reload).
- Tauri app points to Vite dev server via `tauri.conf.json` → `build.devUrl`.
- Rust backend reloads on src-tauri changes.
- Command: `npm run tauri dev`

**Build** (npm run tauri build):
- Vite build outputs to `dist/`.
- Rust backend compiled for release (Windows binary with embedded WebView).
- Output: `src-tauri/target/release/socket_man.exe`
- Command: `npm run tauri build`

### Toolchain Prerequisites (Windows)
- **Node** 16+ (npm 7+)
- **Rust** 1.70+ (`rustup` for Windows MSVC)
- **Visual Studio 2022** (Community/Pro) with C++ build tools OR
- **Visual Studio Code** + MSVC workload (install via `rustup-init.exe`)
- **WebView2 Runtime** pre-installed on Windows 11.

---

## 2. COMMANDS: IPC (UI → Rust)

### Command Definition (Rust)
```rust
// src-tauri/src/lib.rs
use tauri::State;
use std::sync::Mutex;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[tauri::command]
async fn async_work(delay_ms: u64) -> Result<String, String> {
    tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
    Ok("Done!".into())
}

// Pass structs as args (must impl serde::Deserialize + Serialize)
#[derive(serde::Deserialize)]
struct ConnectPayload {
    host: String,
    port: u16,
}

#[tauri::command]
async fn connect(payload: ConnectPayload) -> Result<String, AppError> {
    // Business logic
    Ok(format!("Connected to {}:{}", payload.host, payload.port))
}

// Access managed state
#[tauri::command]
async fn get_connections(state: State<'_, Mutex<Vec<String>>>) -> Result<Vec<String>, AppError> {
    let connections = state.lock().map_err(|_| AppError::StateLockFailed)?;
    Ok(connections.clone())
}
```

### Error Type (Serde-serializable)
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Failed to acquire state lock")]
    StateLockFailed,
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Manually impl Serialize to convert error to string
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
```

### Registration in Builder (main.rs or lib.rs)
```rust
#[tauri::command]
fn invoke_greet() -> String { "Hello".into() }

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            greet,
            async_work,
            connect,
            get_connections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application")
}
```

### State Management Setup
```rust
use std::sync::Mutex;
use std::collections::HashMap;

type ConnectionMap = Mutex<HashMap<String, bool>>;

pub fn run() {
    tauri::Builder::default()
        .manage(ConnectionMap::new(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![/* ... */])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application")
}
```

**Key points**:
- `#[tauri::command]` registers sync/async functions.
- Async commands return `Result<T, E>` where `E` impl `serde::Serialize`.
- `State<'_, T>` for managed state (extracted by type).
- `app.manage(T)` stores T globally; Tauri uses internal HashMap + Arc internally.
- Use `tokio::sync::Mutex` (not `std::sync::Mutex`) for async commands holding locks across `.await`.

### Frontend Invocation (TypeScript)
```typescript
import { invoke } from '@tauri-apps/api/core';

async function callConnect() {
  try {
    const result = await invoke<string>('connect', {
      host: 'localhost',
      port: 8080,
    });
    console.log(result);
  } catch (error) {
    console.error('Command failed:', error);
  }
}
```

---

## 3. EVENTS vs CHANNELS FOR HIGH-RATE STREAMING

### Decision Matrix
| Pattern | Use Case | Throughput | Ordering | Per-Connection | Overhead |
|---------|----------|-----------|----------|----------------|----------|
| **emit()** | Status updates, rare events | Low (1-10 msg/s) | No guarantee | Global | High (JSON serialize per event) |
| **Channel** | WS frame streaming, high-rate data | High (1000+ msg/s) | Guaranteed | Per-command | Low (batched) |

**Recommendation for SocketMan**: Use **Channel** for WS frame streaming; **emit()** only for connection state changes.

### Channels (Recommended for Streaming)

#### Rust Side
```rust
use tauri::ipc::Channel;

#[tauri::command]
async fn stream_websocket_frames(
    host: String,
    channel: Channel<String>,  // Generic type: what we send
) -> Result<(), AppError> {
    // Spawn async task
    tauri::async_runtime::spawn(async move {
        // Pseudo code: connect to WS, loop frames
        for frame in ws_stream {
            let _ = channel.send(serde_json::to_string(&frame).unwrap());
            // If channel.send() errors, the UI/JS side has dropped the receiver
        }
    });
    Ok(())
}
```

#### TypeScript Side
```typescript
import { invoke } from '@tauri-apps/api/core';
import { Channel } from '@tauri-apps/api/core';

async function startStreamingFrames() {
  const channel = new Channel<string>();

  // Listen to frames
  await channel.onmessage((frame) => {
    console.log('Frame:', frame);
  });

  // Start streaming on Rust side
  await invoke('stream_websocket_frames', {
    host: 'ws://localhost:8080',
    channel,
  });
}
```

**Channel lifecycle**:
- JS: Create `Channel<T>`, pass to command.
- Rust: Receive channel param, send data in spawned task.
- JS: `channel.onmessage()` receives `T` (JSON deserialized per type).
- Auto cleanup: Drop channel on either side = closed.

### Events (For State Changes Only)
```rust
// Emit global event
app.emit("connection-status", &serde_json::json!({
    "status": "connected",
    "timestamp": Utc::now(),
}))?;

// Emit to specific window
app.emit_to("main", "connection-status", &serde_json::json!({
    "status": "connected",
}))?;
```

```typescript
import { listen } from '@tauri-apps/api/event';

await listen('connection-status', (event) => {
  console.log('Status:', event.payload);
});
```

**Why NOT events for streaming**:
- Each `emit()` involves JSON serialization + webview boundary crossing.
- No per-command isolation (all events mixed in global listener).
- Events have "no strong type support" (always JSON strings).

---

## 4. ASYNC RUNTIME & TASK SPAWNING

### Tokio Runtime
Tauri v2 provides **tokio runtime** out-of-box via `tauri::async_runtime::spawn()`.

**Does NOT use**: raw `tokio::spawn()` in window event handlers (breaks in v2).

#### Long-Lived Connection Pool
```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;

type ConnectionPool = Arc<Mutex<HashMap<String, mpsc::Sender<String>>>>;

#[tauri::command]
async fn open_connection(
    id: String,
    state: State<'_, ConnectionPool>,
) -> Result<(), AppError> {
    let mut pool = state.lock().map_err(|_| AppError::StateLockFailed)?;
    
    let (tx, mut rx) = mpsc::channel::<String>(100);
    pool.insert(id.clone(), tx);
    
    // Spawn task (use tauri::async_runtime::spawn, NOT tokio::spawn)
    tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            // Process incoming messages
            println!("Msg: {}", msg);
        }
    });
    
    Ok(())
}

#[tauri::command]
async fn send_to_connection(
    id: String,
    msg: String,
    state: State<'_, ConnectionPool>,
) -> Result<(), AppError> {
    let pool = state.lock().map_err(|_| AppError::StateLockFailed)?;
    if let Some(tx) = pool.get(&id) {
        tx.send(msg).await.map_err(|e| AppError::ConnectionFailed(e.to_string()))?;
    }
    Ok(())
}
```

### Pitfalls
1. **Holding `std::sync::Mutex` guard across `.await`**: Guard is not `Send`. Use `tokio::sync::Mutex`.
2. **`tokio::spawn()` in window event handlers**: Panics in v2. Use `tauri::async_runtime::spawn()` instead.
3. **Async command blocking**: Long-running sync work blocks the IPC thread. Use `tokio::task::spawn_blocking()` for CPU-bound ops.

---

## 5. TYPESCRIPT IPC TYPING

### @tauri-apps/api Imports
```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen, emit, emitTo } from '@tauri-apps/api/event';
import { Channel } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
```

### Type Mirroring (Manual Approach)
Define shared types in `src/types.ts`:
```typescript
// src/types.ts
export interface ConnectPayload {
  host: string;
  port: number;
}

export interface Frame {
  type: 'text' | 'binary';
  data: string;
}
```

Mirror in Rust:
```rust
#[derive(serde::Deserialize)]
pub struct ConnectPayload {
    pub host: String,
    pub port: u16,
}

#[derive(serde::Serialize)]
pub struct Frame {
    pub r#type: String, // "type" is reserved in Rust; use #[serde(rename)]
    pub data: String,
}
```

**Lightweight**: Manual mirror works for 5-10 types. No extra tooling.

### tauri-specta (Type-Safe Auto-Generation)
For larger codebases, use `tauri-specta` to auto-generate TS bindings:

```toml
# Cargo.toml
tauri-specta = { version = "2.4", features = ["typescript"] }
specta = "2.0"
```

```rust
use specta::Type;
use tauri_specta::collect_commands;

#[derive(Type, serde::Serialize, serde::Deserialize)]
pub struct Frame {
    pub frame_type: String,
    pub data: String,
}

#[tauri::command]
#[specta::specta]  // Annotation for code-gen
async fn stream_frames(channel: Channel<Frame>) -> Result<(), AppError> {
    // ...
}

// In main.rs/lib.rs
pub fn run() {
    #[cfg(debug_assertions)]
    let _specta = {
        tauri_specta::Builder::new()
            .commands(collect_commands![
                stream_frames,
                // ... other commands
            ])
            .build()
            .expect("Failed to export Specta bindings")
            .export_dir(std::path::PathBuf::from("src/bindings"))
            .expect("Failed to export bindings")
    };

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![stream_frames])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application")
}
```

**Generated** (`src/bindings/index.ts`):
```typescript
// Auto-generated by specta
export const streamFrames = async (channel: Channel<Frame>): Promise<void> => {
  return invoke('stream_frames', { channel });
};
```

**Recommendation**: Manual mirroring for SocketMan MVP. Specta overhead not justified unless 50+ commands.

---

## 6. WINDOW & APP LIFECYCLE CLEANUP

### On Window Close
```rust
use tauri::{Manager, RunEvent};

pub fn run() {
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::WindowEvent { event: tauri::WindowEvent::Destroyed, .. } = event {
                // Window closed: cleanup connections
                if let Some(pool) = app.state::<ConnectionPool>().try_lock() {
                    // Drop all senders → mpsc::Receiver errors, task exits
                    drop(pool);
                }
            }
        })
}
```

### On App Exit
```rust
pub fn run() {
    tauri::Builder::default()
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // App exiting: cleanup
                std::process::exit(0);
            }
        })
}
```

**Key behavior**:
- Dropping `Arc<Mutex<HashMap>>` → senders dropped → `recv()` returns `None` → tasks exit naturally.
- `tokio::spawn()` tasks are NOT automatically cancelled on window/app close (must cleanup explicitly).
- `tauri::async_runtime::spawn()` follows same lifecycle.

---

## 7. TAURI 1 → 2 BREAKING CHANGES

### Commands & Events
- **v1**: `@tauri-apps/api/tauri` module → **v2**: `@tauri-apps/api/core`
- **v1**: `Window` → **v2**: `WebviewWindow`
- **v1**: `emit()` + `listen_global()` → **v2**: `emit_to()` + `listen_any()` (semantic redesign)
- **v1**: IPC payload unpacking (flattens `{ cmd, callback, ... }`) → **v2**: No flattening; direct payload

### Process & Shell APIs
- **v1**: `api::process::Command` in core → **v2**: Removed, replaced by `tauri-plugin-shell`
- **v1**: Clipboard in core → **v2**: `tauri-plugin-clipboard`
- **v1**: CLI matches in core → **v2**: `tauri-plugin-cli`

### New in v2
- **ipc::Channel**: Efficient streaming (high-throughput replacement for emit spam)
- **Tauri plugins**: Modular feature system; shell, clipboard, file-dialog, etc. as plugins
- **Configuration**: `tauri.conf.json` schema more flexible; support JSON5/TOML via features

### Window Creation
**v1**:
```rust
tauri::WindowBuilder::new(...)
```

**v2**:
```rust
tauri::WebviewWindowBuilder::new(&app, "label", tauri::WebviewUrl::App("index.html".into()))
    .build()?
```

---

## RECOMMENDATIONS FOR SOCKETMAN

1. **Scaffolding**: Use `npm create tauri-app@latest socket-man -- --template react`. Target Node 18+, Rust 1.70+.

2. **State**: 
   - For connection pool: `Arc<Mutex<HashMap<String, mpsc::Sender<_>>>>` + `app.manage()`.
   - Use `tokio::sync::Mutex` (not `std::sync::Mutex`) in async commands.

3. **IPC**:
   - **UI→Rust**: Commands with `#[tauri::command]` + custom `AppError` impl `serde::Serialize`.
   - **Rust→UI**: Channels for WS frame streaming; events only for connection status.

4. **High-Rate Streaming**:
   - Use `tauri::ipc::Channel<T>` for WS frames. Pass from command, send from `tauri::async_runtime::spawn()`.
   - JS: `new Channel<Frame>()` → `channel.onmessage()` → receive typed frames.
   - Throughput: ~1000+ msgs/s feasible vs ~10 msgs/s with events.

5. **Typing**: Manual type mirror (ConnectPayload, Frame) in src/types.ts + Rust structs. Add tauri-specta only if 50+ commands.

6. **Cleanup**: 
   - Window close → `RunEvent::WindowEvent::Destroyed` → drop state/senders.
   - App exit → `RunEvent::ExitRequested` → `std::process::exit(0)`.

7. **Dev Setup**:
   - `npm run dev` → Vite + Tauri in tandem.
   - `npm run tauri build` → Release binary (single exe for Windows).

---

## UNRESOLVED QUESTIONS

1. **High-concurrency WebSocket handling**: Does Tauri v2 handle 1000+ concurrent WS connections? Recommend load-testing with actual ws-rs or tokio-tungstenite before prod.

2. **Channel batching**: Should frames be batched (e.g., 10 at a time) before send, or send-on-arrival? Depends on frontend rendering perf — needs empirical testing.

3. **Error serialization complexity**: If error variants contain non-serializable types (e.g., `Box<dyn Error>`), manual `Serialize` impl becomes verbose. Consider error code enums + string messages for UX simplicity.

4. **Plugin ecosystem maturity**: `tauri-plugin-shell`, `tauri-plugin-clipboard` stable as of 2026, but custom plugins? Verify community adoption for any non-core needs.

---

## SOURCES

- [Tauri v2 Create Project](https://v2.tauri.app/start/create-project/)
- [Tauri v2 State Management](https://v2.tauri.app/develop/state-management/)
- [Tauri v2 Calling Rust from Frontend](https://v2.tauri.app/develop/calling-rust/)
- [Tauri v2 Calling Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri v2 IPC Concept](https://v2.tauri.app/concept/inter-process-communication/)
- [Tauri v2 Upgrade from v1](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [DEV: Rust Async in Tauri v2](https://dev.to/hiyoyok/rust-async-in-tauri-v2-what-tripped-me-up-and-how-i-fixed-it-1662)
- [DEV: Error Handling in Tauri Commands](https://dev.to/hiyoyok/rust-error-handling-in-tauri-commands-the-pattern-that-actually-works-35le)
- [tauri-specta v2 Docs](https://docs.rs/tauri-specta/latest/tauri_specta/)
- [How I Built a Desktop AI App with Tauri v2 + React 19 in 2026](https://dev.to/purpledoubled/how-i-built-a-desktop-ai-app-with-tauri-v2-react-19-in-2026-1g47)
