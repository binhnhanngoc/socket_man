// Connection bar: protocol chip, URL field with live env-resolved preview,
// status chip + timer, connect/disconnect. Ported from design/workspace.jsx.
import type { Environment, Item } from "../types";
import type { ConnStatusKind } from "../transport/transport";
import { fmtDur } from "../lib/util";
import { resolveEnv } from "../lib/resolve-env";
import { maskSecretTokens } from "../lib/secret-refs";
import { IconGlobe2, IconPlug, IconBolt } from "./icons";

interface ConnectionBarProps {
  item: Item;
  status: ConnStatusKind;
  elapsed: number;
  /** Last heartbeat round-trip time (ms), shown when connected. */
  rttMs?: number;
  /** True when TLS verification is disabled for this connection (red badge). */
  insecureTls?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onUrl: (v: string) => void;
  env: Environment | null;
}

const TOKEN_RE = /\{\{\s*[\w.-]+\s*\}\}/;

export function ConnectionBar({ item, status, elapsed, rttMs, insecureTls, onConnect, onDisconnect, onUrl, env }: ConnectionBarProps) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  const reconnecting = status === "reconnecting";
  const hasTokens = TOKEN_RE.test(item.url);
  // Resolve preview with skipSecret so a secret token in a URL is NOT rendered
  // to the DOM — it stays literal ({{token}}) and is resolved Rust-side (F1).
  const resolved = hasTokens ? maskSecretTokens(resolveEnv(item.url, env, { skipSecret: true }), env) : null;
  return (
    <div className="conn-bar">
      <span className={"proto-chip " + item.kind}>{item.kind === "ws" ? "WSS" : item.method}</span>
      {insecureTls && (
        <span className="tls-badge" title="TLS verification is OFF for this connection (MITM risk)">
          TLS OFF
        </span>
      )}
      <div className="url-field">
        <input className="url-input" value={item.url} onChange={(e) => onUrl(e.target.value)} spellCheck={false} />
        {hasTokens && (
          <div className="url-resolved" title={env ? "Resolved with " + env.name : "No environment selected"}>
            <IconGlobe2 size={12} />
            <span className="url-resolved-val">{resolved}</span>
            {!env && <span className="url-resolved-warn">no environment</span>}
          </div>
        )}
      </div>
      <div className={"status-chip " + status}>
        <span className="conn-dot"></span>
        {connected ? "Connected" : connecting ? "Connecting…" : reconnecting ? "Reconnecting…" : "Disconnected"}
        {connected && <span className="status-timer">{fmtDur(elapsed)}</span>}
        {connected && rttMs != null && <span className="conn-rtt" title="Heartbeat round-trip time">{rttMs} ms</span>}
      </div>
      {connected || connecting || reconnecting ? (
        <button className="btn btn-secondary" onClick={onDisconnect}>
          <IconPlug size={15} /> Disconnect
        </button>
      ) : (
        <button className="btn btn-rust" onClick={onConnect}>
          <IconBolt size={15} /> Connect
        </button>
      )}
    </div>
  );
}
