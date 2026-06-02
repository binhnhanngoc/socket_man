// use-http — per-item HTTP request draft + last response + loading/error.
//
// Holds the editable request (method / url / header rows / body) and drives a send
// through the Transport. SECURITY (F1): URL, header values, and body are resolved
// with `{ skipSecret: true }` so a `{{secretToken}}` stays LITERAL and never enters
// the HttpRequest handed across IPC — secret substitution happens Rust-side (Phase 5).
//
// The transport is injected (defaults to the real singleton) so tests can drive it
// with a stub without touching the Tauri bridge.

import { useCallback, useState } from "react";
import type { Environment, HeaderRow, Item } from "../types";
import type { HttpResponse, Transport } from "../transport/transport";
import { transport as defaultTransport } from "../transport";
import { resolveEnv } from "../lib/resolve-env";
import { secretRefsFor } from "../lib/secret-refs";
import { appendHistory } from "../lib/history-log";

const uid = () => "hh-" + Math.random().toString(36).slice(2, 9);

/** Methods that carry a request body. */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function useHttp(item: Item, env: Environment | null, tp: Transport = defaultTransport) {
  const [method, setMethod] = useState(item.method || "GET");
  const [url, setUrl] = useState(item.url);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const addHeader = useCallback(() => setHeaders((rows) => [...rows, { id: uid(), k: "", v: "" }]), []);
  const setHeaderRow = useCallback(
    (id: string, patch: Partial<HeaderRow>) =>
      setHeaders((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    []
  );
  const removeHeader = useCallback((id: string) => setHeaders((rows) => rows.filter((r) => r.id !== id)), []);

  const send = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Resolve NON-secret tokens only; secret tokens stay literal for Rust-side
    // substitution. This is the guarantee that no plaintext secret crosses IPC.
    const resolvedUrl = resolveEnv(url, env, { skipSecret: true });
    const hdrs: Record<string, string> = {};
    for (const r of headers) {
      const k = r.k.trim();
      if (k) hdrs[k] = resolveEnv(r.v, env, { skipSecret: true });
    }
    const hasBody = BODY_METHODS.has(method.toUpperCase()) && body.trim() !== "";
    const req = {
      method,
      url: resolvedUrl,
      headers: hdrs,
      body: hasBody ? resolveEnv(body, env, { skipSecret: true }) : undefined,
    };
    try {
      const res = await tp.httpSend(req, secretRefsFor(env));
      setResponse(res);
      // Append a TEMPLATE-form history entry (raw, unresolved url/headers/body — no
      // resolved secret can land in history).
      appendHistory({
        kind: "http",
        itemId: item.id,
        label: `${method} ${url}`,
        summary: `${res.status} ${res.statusText} · ${res.timingMs} ms`,
        payload: { method, url, headers: headers.map((r) => ({ k: r.k, v: r.v })), body },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResponse(null);
    } finally {
      setLoading(false);
    }
  }, [method, url, headers, body, env, tp]);

  const hasBody = BODY_METHODS.has(method.toUpperCase());

  return {
    method,
    setMethod,
    url,
    setUrl,
    headers,
    addHeader,
    setHeaderRow,
    removeHeader,
    body,
    setBody,
    hasBody,
    response,
    error,
    loading,
    send,
  };
}
