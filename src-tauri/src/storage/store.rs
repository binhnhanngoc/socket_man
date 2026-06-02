// JSON file store in the app data dir. Writes are atomic (unique temp + fsync +
// rename) and corrupt/missing files load as `Null` so a bad file never panics the
// app. The per-file lock that serializes concurrent writers lives in StorageManager;
// the caller holds it around `save`/history append.

use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::Value;
use tokio::io::AsyncWriteExt;

use crate::error::AppError;

static WRITE_NONCE: AtomicU64 = AtomicU64::new(0);

/// Validate a store name (webview-supplied) to prevent path traversal: a short slug
/// of `[A-Za-z0-9_-]` only. The `.json` extension is added here.
fn validate_name(name: &str) -> Result<(), AppError> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(AppError::Storage(format!("invalid store name: {name}")))
    }
}

fn path_for(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.json"))
}

/// Load a JSON file. Missing OR unparseable → `Value::Null` (callers default from it),
/// so a partially-written or hand-corrupted file degrades gracefully.
pub async fn load(dir: &Path, name: &str) -> Result<Value, AppError> {
    validate_name(name)?;
    match tokio::fs::read(path_for(dir, name)).await {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(AppError::Storage(e.to_string())),
    }
}

/// Atomic save: write a UNIQUE temp file (no clobber between concurrent writers),
/// fsync it, then rename over the target. Caller MUST hold the per-file lock so two
/// saves to the same name serialize. On Windows a rename-over can transiently fail
/// (AV/indexer holding the target) → retry a few times before surfacing an error.
pub async fn save(dir: &Path, name: &str, value: &Value) -> Result<(), AppError> {
    validate_name(name)?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| AppError::Storage(e.to_string()))?;
    let body = serde_json::to_vec_pretty(value).map_err(|e| AppError::Storage(e.to_string()))?;

    let nonce = WRITE_NONCE.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("{name}.{}.{nonce}.tmp", process::id()));

    {
        let mut f = tokio::fs::File::create(&tmp).await.map_err(|e| AppError::Storage(e.to_string()))?;
        f.write_all(&body).await.map_err(|e| AppError::Storage(e.to_string()))?;
        f.sync_all().await.map_err(|e| AppError::Storage(e.to_string()))?;
    }

    let target = path_for(dir, name);
    let mut last = String::new();
    for attempt in 0..5 {
        match tokio::fs::rename(&tmp, &target).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = e.to_string();
                tokio::time::sleep(Duration::from_millis(20 * (attempt + 1))).await;
            }
        }
    }
    let _ = tokio::fs::remove_file(&tmp).await;
    Err(AppError::Storage(format!("rename failed after retries: {last}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_dir() -> PathBuf {
        let n = WRITE_NONCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("socketman-store-test-{}-{n}", process::id()))
    }

    #[tokio::test]
    async fn save_then_load_round_trips() {
        let dir = tmp_dir();
        let v = json!({"a": 1, "b": ["x", "y"], "nested": {"k": true}});
        save(&dir, "collections", &v).await.unwrap();
        let back = load(&dir, "collections").await.unwrap();
        assert_eq!(back, v);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn missing_file_loads_as_null() {
        let dir = tmp_dir();
        assert_eq!(load(&dir, "history").await.unwrap(), Value::Null);
    }

    #[tokio::test]
    async fn corrupt_file_loads_as_null_no_panic() {
        let dir = tmp_dir();
        tokio::fs::create_dir_all(&dir).await.unwrap();
        tokio::fs::write(dir.join("environments.json"), b"{ this is not json ]]").await.unwrap();
        assert_eq!(load(&dir, "environments").await.unwrap(), Value::Null);
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn rejects_path_traversal_names() {
        let dir = tmp_dir();
        assert!(save(&dir, "../evil", &json!({})).await.is_err());
        assert!(load(&dir, "a/b").await.is_err());
        assert!(load(&dir, "").await.is_err());
    }

    #[tokio::test]
    async fn concurrent_saves_to_same_file_serialize_and_stay_valid() {
        use crate::storage::StorageManager;
        use std::sync::Arc;
        let dir = tmp_dir();
        let mgr = Arc::new(StorageManager::new(dir.clone()));
        let mut handles = Vec::new();
        for i in 0..16u64 {
            let mgr = mgr.clone();
            let dir = dir.clone();
            handles.push(tokio::spawn(async move {
                let lock = mgr.lock_for("history");
                let _g = lock.lock().await;
                save(&dir, "history", &json!({"writer": i})).await.unwrap();
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
        // The file is one writer's complete, valid output — never a truncated mix.
        let back = load(&dir, "history").await.unwrap();
        assert!(back.get("writer").and_then(|w| w.as_u64()).is_some(), "got: {back}");
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
