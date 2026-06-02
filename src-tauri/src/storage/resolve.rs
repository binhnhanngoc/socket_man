// Secret resolution — the ONLY place plaintext secrets materialize, and only on the
// outbound path (ws connect/send, http send). Resolves ONLY secret `{{key}}` tokens
// (non-secret vars were already substituted by the frontend); unknown tokens stay
// intact. Per-context validation (S8) blocks header injection and host re-pointing.

use crate::error::AppError;
use crate::storage::secrets;

/// Where a resolved secret is about to be placed — drives validation/encoding.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SecretCtx {
    /// HTTP/WS header value: CR/LF would smuggle extra headers → reject.
    Header,
    /// URL (or a component of it): percent-encode so `/`/`@`/`:` can't re-point the host.
    Url,
    /// Request/message body: substituted verbatim.
    Body,
}

/// Substitute secret tokens in `s`. Values are fetched + validated FIRST; only if all
/// succeed are they spliced in — so a missing/invalid key returns an error with NO
/// partial substitution (no half-leaked string ever escapes).
pub fn resolve_secrets(
    s: &str,
    env_id: &str,
    secret_keys: &[String],
    ctx: SecretCtx,
) -> Result<String, AppError> {
    let mut sink = Vec::new();
    resolve_secrets_into(s, env_id, secret_keys, ctx, &mut sink)
}

/// Same as `resolve_secrets`, but also pushes each resolved secret VALUE into `used`.
/// Callers collect these to scrub the values out of any error/reason string later
/// (a secret resolved into a URL must not ride a connect-error message back to JS).
pub fn resolve_secrets_into(
    s: &str,
    env_id: &str,
    secret_keys: &[String],
    ctx: SecretCtx,
    used: &mut Vec<String>,
) -> Result<String, AppError> {
    let mut subs: Vec<(String, String)> = Vec::new();
    for k in secret_keys {
        let token = format!("{{{{{k}}}}}");
        if s.contains(&token) {
            let value = secrets::get(env_id, k)?;
            subs.push((token, validate_value(&value, ctx)?));
        }
    }
    let mut out = s.to_string();
    for (token, value) in subs {
        out = out.replace(&token, &value);
        used.push(value);
    }
    Ok(out)
}

fn validate_value(v: &str, ctx: SecretCtx) -> Result<String, AppError> {
    if v.len() > 8192 {
        return Err(AppError::Secret("secret value too long".into()));
    }
    match ctx {
        SecretCtx::Header => {
            if v.bytes().any(|b| b == b'\r' || b == b'\n') {
                return Err(AppError::Secret("secret contains CR/LF (header injection blocked)".into()));
            }
            Ok(v.to_string())
        }
        SecretCtx::Url => Ok(pct_component(v)),
        SecretCtx::Body => Ok(v.to_string()),
    }
}

/// Percent-encode a URL component: keep RFC 3986 unreserved chars, encode the rest
/// (notably `/ @ : ? # &`) so a secret value can't alter the host/path structure.
fn pct_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // These use the real keychain via a dedicated test env, mirroring secrets.rs.
    const ENV: &str = "test-env-resolve";

    fn seed(key: &str, value: &str) {
        let _ = secrets::delete(ENV, key);
        secrets::set(ENV, key, value).unwrap();
    }

    #[test]
    fn resolves_secret_token_leaves_others_intact() {
        seed("token", "atk_live_xyz");
        let keys = vec!["token".to_string()];
        let out = resolve_secrets("Bearer {{token}} {{plant_id}} {{unknown}}", ENV, &keys, SecretCtx::Header).unwrap();
        assert_eq!(out, "Bearer atk_live_xyz {{plant_id}} {{unknown}}");
        let _ = secrets::delete(ENV, "token");
    }

    #[test]
    fn missing_key_errors_without_partial_substitution() {
        seed("present", "VALUE_A");
        let _ = secrets::delete(ENV, "absent");
        let keys = vec!["present".to_string(), "absent".to_string()];
        let res = resolve_secrets("{{present}} and {{absent}}", ENV, &keys, SecretCtx::Body);
        assert!(res.is_err(), "missing key must error, not half-substitute");
        let _ = secrets::delete(ENV, "present");
    }

    #[test]
    fn crlf_in_header_secret_is_rejected() {
        seed("evil", "good\r\nX-Injected: pwned");
        let keys = vec!["evil".to_string()];
        let res = resolve_secrets("Authorization: {{evil}}", ENV, &keys, SecretCtx::Header);
        assert!(res.is_err(), "CR/LF in a header secret must be rejected");
        let _ = secrets::delete(ENV, "evil");
    }

    #[test]
    fn url_secret_is_percent_encoded() {
        seed("urlsec", "a/b@host:9000");
        let keys = vec!["urlsec".to_string()];
        let out = resolve_secrets("https://api/{{urlsec}}/x", ENV, &keys, SecretCtx::Url).unwrap();
        assert!(out.contains("a%2Fb%40host%3A9000"), "URL secret not encoded: {out}");
        assert!(!out.contains("a/b@host"), "raw reserved chars must not survive: {out}");
        let _ = secrets::delete(ENV, "urlsec");
    }

    #[test]
    fn crlf_allowed_in_body_context() {
        // A body legitimately can contain newlines; only headers reject them.
        seed("multiline", "line1\nline2");
        let keys = vec!["multiline".to_string()];
        let out = resolve_secrets("{{multiline}}", ENV, &keys, SecretCtx::Body).unwrap();
        assert_eq!(out, "line1\nline2");
        let _ = secrets::delete(ENV, "multiline");
    }
}
