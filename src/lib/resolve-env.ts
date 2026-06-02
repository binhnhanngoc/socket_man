// Environment variable resolution — the SECURITY-CRITICAL secret-skipping path.
//
// The prototype's resolveEnv (design/data.js:166) resolved EVERY {{key}}. Here,
// the send/connect/HTTP paths call with { skipSecret: true } so that any var
// marked `secret: true` is LEFT LITERAL ({{token}} stays as-is) and never enters
// the JS heap. Secret tokens are substituted Rust-side at send/connect time
// (Phase 5). Non-secret vars still resolve in JS for live URL preview etc.
//
// This is a pure function (no React) so it is unit-testable and reusable
// unchanged by every call site. The hook (use-environments) re-exports it.

import type { Environment } from "../types";

export interface ResolveOpts {
  /** When true, vars marked secret are left as the literal `{{key}}` token. */
  skipSecret?: boolean;
}

const TOKEN_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Replace `{{key}}` tokens in `str` with the active environment's values.
 * - Unknown tokens are left verbatim.
 * - A null/undefined env returns the input unchanged.
 * - With `skipSecret: true`, tokens whose var is `secret: true` stay literal.
 */
export function resolveEnv(
  str: string,
  env: Environment | null | undefined,
  opts: ResolveOpts = {}
): string {
  if (!str || !env) return str;
  const vars = env.vars || [];
  return str.replace(TOKEN_RE, (match, key: string) => {
    const v = vars.find((x) => x.key === key);
    if (!v) return match; // unknown token: leave verbatim
    if (opts.skipSecret && v.secret) return match; // secret: leave literal, resolve Rust-side
    return v.value;
  });
}
