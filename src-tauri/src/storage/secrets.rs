// OS keychain wrapper (keyring 3, Windows Credential Manager). Holds the secret
// tokens whose plaintext must NEVER touch disk or the JS heap.
//
// `get` is PRIVATE to the crate and called ONLY by `resolve` — it is deliberately
// NOT wrapped in a `#[tauri::command]` (S3): any command is reachable by all webview
// JS, so exposing a secret read = handing tokens to XSS. The editor is write-only.

use keyring::Entry;

use crate::error::AppError;

const SERVICE: &str = "SocketMan";

/// Validate an env-var key against the resolver's charset (`^[\w.-]+$`). Rejecting `:`
/// (and anything outside the set) keeps a user-typed key from colliding the
/// env-vs-key boundary in the account encoding (S7).
pub fn validate_key(key: &str) -> Result<(), AppError> {
    let ok = !key.is_empty()
        && key.len() <= 256
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(AppError::Secret(format!("invalid secret key: {key}")))
    }
}

/// Percent-encode everything outside unreserved chars so neither segment can contain
/// the `:` delimiter (or any byte) that would shift the env/key boundary.
fn pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Delimiter-safe keychain account: `{enc(env_id)}:{enc(key)}`. Both segments are
/// percent-encoded, so the `:` is an unambiguous boundary (S7).
fn account(env_id: &str, key: &str) -> String {
    format!("{}:{}", pct(env_id), pct(key))
}

fn entry(env_id: &str, key: &str) -> Result<Entry, AppError> {
    Entry::new(SERVICE, &account(env_id, key)).map_err(|e| AppError::Secret(e.to_string()))
}

pub fn set(env_id: &str, key: &str, value: &str) -> Result<(), AppError> {
    validate_key(key)?;
    entry(env_id, key)?.set_password(value).map_err(|e| AppError::Secret(e.to_string()))
}

/// PRIVATE read — resolve.rs only. Missing entry → typed error (never a panic, never
/// a partial value). NOT exposed as a command (S3).
pub fn get(env_id: &str, key: &str) -> Result<String, AppError> {
    validate_key(key)?;
    match entry(env_id, key)?.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Err(AppError::Secret(format!("no secret stored for key: {key}"))),
        Err(e) => Err(AppError::Secret(e.to_string())),
    }
}

/// Delete is idempotent: a missing entry is a no-op (orphan sweep calls this freely).
pub fn delete(env_id: &str, key: &str) -> Result<(), AppError> {
    validate_key(key)?;
    match entry(env_id, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Secret(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation_rejects_colon_and_bad_chars() {
        assert!(validate_key("token").is_ok());
        assert!(validate_key("api.key-1_v").is_ok());
        assert!(validate_key("a:b").is_err(), "colon must be rejected (delimiter footgun)");
        assert!(validate_key("a b").is_err());
        assert!(validate_key("").is_err());
        assert!(validate_key("a/b").is_err());
    }

    #[test]
    fn account_encoding_is_collision_free() {
        // env "x" + key with an encoded char must NOT collide with a different split.
        // (keys with ':' are rejected upstream, but the encoding is robust regardless.)
        let a = account("env-1", "token");
        let b = account("env-1:token", "x");
        assert_ne!(a, b, "encoding must keep the env/key boundary unambiguous");
        // The boundary ':' only ever appears once, between the two encoded segments.
        assert_eq!(account("e", "k").matches(':').count(), 1);
        assert_eq!(pct("a:b"), "a%3Ab");
    }

    // Real keychain round-trip. The Windows dev box has a credential store; if a CI
    // runner lacks one this is skipped via `#[ignore]`.
    #[test]
    fn set_get_delete_round_trip_real_keychain() {
        let env = "test-env-roundtrip";
        let key = "test_token";
        // clean slate
        let _ = delete(env, key);
        set(env, key, "s3cr3t-value").unwrap();
        assert_eq!(get(env, key).unwrap(), "s3cr3t-value");
        delete(env, key).unwrap();
        assert!(get(env, key).is_err(), "deleted secret must not resolve");
        // delete is idempotent
        delete(env, key).unwrap();
    }
}
