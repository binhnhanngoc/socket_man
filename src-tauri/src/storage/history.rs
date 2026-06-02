// History append — Rust-owned (S2/F6). The frontend hands a TEMPLATE-form entry
// (pre-resolution, secret tokens still literal); Rust loads, prepends (newest-first),
// caps, and atomically rewrites under the per-file lock. The frontend never does a
// read-modify-write of its (possibly secret-resolved) connection state.

use std::path::Path;

use serde_json::Value;

use crate::error::AppError;
use crate::storage::store;

/// Hard cap on retained history entries (oldest dropped). Virtualization is future work.
const CAP: usize = 500;

/// Prepend one entry to `history.json` and cap. Caller holds the "history" file lock.
pub async fn append(dir: &Path, entry: Value) -> Result<(), AppError> {
    let mut list: Vec<Value> = match store::load(dir, "history").await? {
        Value::Array(a) => a,
        _ => Vec::new(),
    };
    list.insert(0, entry);
    if list.len() > CAP {
        list.truncate(CAP);
    }
    store::save(dir, "history", &Value::Array(list)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::StorageManager;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    static N: AtomicU64 = AtomicU64::new(0);
    fn tmp_dir() -> std::path::PathBuf {
        let n = N.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("socketman-history-{}-{n}", std::process::id()))
    }

    #[tokio::test]
    async fn appends_newest_first_and_caps() {
        let dir = tmp_dir();
        for i in 0..(CAP as u64 + 10) {
            append(&dir, json!({"i": i})).await.unwrap();
        }
        let list = match store::load(&dir, "history").await.unwrap() {
            Value::Array(a) => a,
            _ => panic!("expected array"),
        };
        assert_eq!(list.len(), CAP, "must cap at {CAP}");
        // Newest-first: the last appended (i = CAP+9) is at index 0.
        assert_eq!(list[0]["i"].as_u64(), Some(CAP as u64 + 9));
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn concurrent_appends_lose_nothing_under_the_lock() {
        let dir = tmp_dir();
        let mgr = Arc::new(StorageManager::new(dir.clone()));
        let mut handles = Vec::new();
        for i in 0..20u64 {
            let mgr = mgr.clone();
            let dir = dir.clone();
            handles.push(tokio::spawn(async move {
                let lock = mgr.lock_for("history");
                let _g = lock.lock().await;
                append(&dir, json!({"i": i})).await.unwrap();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        let list = match store::load(&dir, "history").await.unwrap() {
            Value::Array(a) => a,
            _ => panic!("expected array"),
        };
        assert_eq!(list.len(), 20, "every concurrent append must be retained");
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
