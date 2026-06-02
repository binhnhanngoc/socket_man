// Persistence & secrets (Phase 5).
//
// - `store`   JSON load/save in the app data dir (atomic write, corrupt-tolerant).
// - `secrets` OS keychain wrapper (keyring). `get` is PRIVATE — never a command.
// - `resolve` secret `{{token}}` substitution, Rust-only, with per-context validation.
// - `history` Rust-side append (templates only, capped) under the per-file lock.
//
// The SECURITY keystone: plaintext secrets resolve only here, on the outbound path,
// and never enter any JSON file, frame log, history entry, or IPC response to JS.

pub mod history;
pub mod resolve;
pub mod secrets;
pub mod store;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

/// Managed Tauri state: the app data dir + a per-file async lock so concurrent
/// `storage_save` / `history_append` to the SAME file serialize (no clobber, F6).
pub struct StorageManager {
    pub dir: PathBuf,
    locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl StorageManager {
    pub fn new(dir: PathBuf) -> Self {
        StorageManager { dir, locks: Mutex::new(HashMap::new()) }
    }

    /// Get-or-create the lock for one logical file. Returns a clone so the caller can
    /// `.lock().await` it; same `name` always yields the same underlying mutex.
    pub fn lock_for(&self, name: &str) -> Arc<AsyncMutex<()>> {
        let mut map = self.locks.lock().unwrap();
        map.entry(name.to_string()).or_insert_with(|| Arc::new(AsyncMutex::new(()))).clone()
    }
}
