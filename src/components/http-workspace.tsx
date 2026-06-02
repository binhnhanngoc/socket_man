// HTTP workspace: method + URL + Send connection bar, request editor (body/headers),
// and the response view. Wired to the real reqwest-backed `transport.httpSend` via
// the `use-http` hook. Env vars resolve with skipSecret (secret tokens stay literal
// and are substituted Rust-side at send — Phase 5).
import type { Environment, Item } from "../types";
import { useHttp } from "../hooks/use-http";
import { resolveEnv } from "../lib/resolve-env";
import { maskSecretTokens } from "../lib/secret-refs";
import { HttpRequestEditor } from "./http-request-editor";
import { HttpResponseView } from "./http-response-view";
import { IconSend, IconGlobe2 } from "./icons";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const TOKEN_RE = /\{\{\s*[\w.-]+\s*\}\}/;

export function HttpWorkspace({ item, env }: { item: Item; env: Environment | null }) {
  const http = useHttp(item, env);
  const hasTokens = TOKEN_RE.test(http.url);
  // Preview with skipSecret so a secret token in the URL is never rendered to the DOM.
  const resolved = hasTokens ? maskSecretTokens(resolveEnv(http.url, env, { skipSecret: true }), env) : null;

  return (
    <div className="http-ws">
      <div className="conn-bar">
        <select
          className={"proto-chip http m-" + http.method}
          value={http.method}
          onChange={(e) => http.setMethod(e.target.value)}
          title="HTTP method"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="url-field">
          <input
            className="url-input"
            value={http.url}
            spellCheck={false}
            onChange={(e) => http.setUrl(e.target.value)}
          />
          {hasTokens && (
            <div className="url-resolved" title={env ? "Resolved with " + env.name : "No environment selected"}>
              <IconGlobe2 size={12} />
              <span className="url-resolved-val">{resolved}</span>
              {!env && <span className="url-resolved-warn">no environment</span>}
            </div>
          )}
        </div>
        <button className="btn btn-rust" onClick={http.send} disabled={http.loading || !http.url.trim()}>
          {http.loading ? "Sending…" : "Send"}
          <IconSend size={15} />
        </button>
      </div>

      <HttpRequestEditor
        hasBody={http.hasBody}
        headers={http.headers}
        addHeader={http.addHeader}
        setHeaderRow={http.setHeaderRow}
        removeHeader={http.removeHeader}
        body={http.body}
        setBody={http.setBody}
      />

      <div className="http-panel">
        {http.error ? (
          <div className="auth-note danger-note">Request failed: {http.error}</div>
        ) : http.response ? (
          <HttpResponseView response={http.response} />
        ) : (
          <div className="empty-sm">{http.loading ? "Sending request…" : "Send the request to see a response."}</div>
        )}
      </div>
    </div>
  );
}
