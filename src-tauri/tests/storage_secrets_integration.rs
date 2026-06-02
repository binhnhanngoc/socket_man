// Phase 5 end-to-end: the no-leak keystone. Proves that a secret token resolves to its
// real value on the OUTBOUND path (so the network gets the real token) while the
// TEMPLATE form is what lands in persisted JSON (history) — the resolved secret never
// touches disk. Resolution + validation unit coverage lives in storage::resolve;
// store/secrets/history persistence coverage lives in those modules. This ties them
// together against the REAL keychain + a real on-disk store.

use std::sync::atomic::{AtomicU64, Ordering};
use std::path::PathBuf;

use serde_json::{json, Value};

use socketman_lib::storage::resolve::{resolve_secrets, SecretCtx};
use socketman_lib::storage::{history, secrets, store};

const ENV: &str = "test-env-e2e-noleak";
const SECRET: &str = "atk_live_DO_NOT_LEAK_9f2a";

static N: AtomicU64 = AtomicU64::new(0);
fn tmp_dir() -> PathBuf {
    let n = N.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("socketman-e2e-{}-{n}", std::process::id()))
}

#[tokio::test]
async fn secret_reaches_wire_but_only_template_is_persisted() {
    // Seed the secret in the real keychain.
    let _ = secrets::delete(ENV, "token");
    secrets::set(ENV, "token", SECRET).unwrap();
    let keys = vec!["token".to_string()];

    // --- outbound path: the wire carries the REAL token (header + url + body) ---
    let header_wire = resolve_secrets("Bearer {{token}}", ENV, &keys, SecretCtx::Header).unwrap();
    let url_wire = resolve_secrets("https://api/x?k={{token}}", ENV, &keys, SecretCtx::Url).unwrap();
    let body_wire = resolve_secrets("{\"auth\":\"{{token}}\"}", ENV, &keys, SecretCtx::Body).unwrap();
    assert!(header_wire.contains(SECRET), "header must carry the real token on the wire");
    // SECRET is all RFC-3986 unreserved chars, so URL encoding leaves it verbatim.
    assert!(url_wire.contains(SECRET), "url must carry the token on the wire: {url_wire}");
    assert!(body_wire.contains(SECRET), "body must carry the real token on the wire");

    // --- persistence path: history stores the TEMPLATE (pre-resolution) only ---
    let dir = tmp_dir();
    let template_entry = json!({
        "kind": "http",
        "label": "POST https://api/x",
        "request": { "headers": { "Authorization": "Bearer {{token}}" }, "url": "https://api/x?k={{token}}", "body": "{\"auth\":\"{{token}}\"}" }
    });
    history::append(&dir, template_entry).await.unwrap();

    // Read the raw bytes off disk and prove the resolved secret is absent.
    let raw = tokio::fs::read_to_string(dir.join("history.json")).await.unwrap();
    assert!(!raw.contains(SECRET), "RESOLVED SECRET LEAKED INTO history.json:\n{raw}");
    assert!(raw.contains("{{token}}"), "history must retain the template form: {raw}");

    // The loaded value is also template-only.
    let loaded = store::load(&dir, "history").await.unwrap();
    let serialized = serde_json::to_string(&loaded).unwrap();
    assert!(!serialized.contains(SECRET), "resolved secret present in loaded history");

    // environments.json must NEVER hold the value either — only a {key, secret} ref.
    let env_doc: Value = json!([{ "id": ENV, "name": "Local", "vars": [{ "key": "token", "secret": true }] }]);
    store::save(&dir, "environments", &env_doc).await.unwrap();
    let env_raw = tokio::fs::read_to_string(dir.join("environments.json")).await.unwrap();
    assert!(!env_raw.contains(SECRET), "secret value leaked into environments.json");

    // cleanup
    let _ = secrets::delete(ENV, "token");
    let _ = tokio::fs::remove_dir_all(&dir).await;
}
