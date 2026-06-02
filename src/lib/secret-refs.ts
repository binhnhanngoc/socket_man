// Build the SecretRefs passed to the transport so Rust can resolve `{{secretKey}}`
// tokens on the outbound path. Only the KEYS of secret-marked vars travel — the
// values live in the OS keychain and are read Rust-side, never here.

import type { Environment } from "../types";
import type { SecretRefs } from "../transport/transport";

export function secretRefsFor(env: Environment | null | undefined): SecretRefs | undefined {
  if (!env) return undefined;
  const secretKeys = (env.vars || []).filter((v) => v.secret && v.key.trim()).map((v) => v.key);
  if (secretKeys.length === 0) return undefined;
  return { envId: env.id, secretKeys };
}

/** Mask secret `{{token}}` segments in a display string as `••••` so a resolved-URL
 *  preview never even shows the literal secret key. Non-secret tokens are untouched. */
export function maskSecretTokens(s: string, env: Environment | null | undefined): string {
  if (!env) return s;
  let out = s;
  for (const v of env.vars || []) {
    if (v.secret && v.key.trim()) {
      out = out.split(`{{${v.key}}}`).join("••••");
    }
  }
  return out;
}
