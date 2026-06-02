// WS workspace tabs: Headers / Auth / Settings panes.
//
// Phase 2 wires Headers + Auth to per-item connection meta (F14): these compose into
// `ConnectConfig.headers` at connect time — the user-driven path for the custom
// `Authorization` header on the WS upgrade (the project's one hard requirement).
// Settings stays display-only (Phase 3 binds its hardcoded reliability defaults).
import type { ConnMeta, HeaderRow } from "../types";
import { IconPlus, IconChevron, IconTrash } from "./icons";

const uid = () => "h-" + Math.random().toString(36).slice(2, 9);

interface PaneProps {
  meta: ConnMeta;
  onChange: (patch: Partial<ConnMeta>) => void;
}

export function HeadersPane({ meta, onChange }: PaneProps) {
  const rows = meta.headers;
  const setRow = (id: string, patch: Partial<HeaderRow>) =>
    onChange({ headers: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const addRow = () => onChange({ headers: [...rows, { id: uid(), k: "", v: "" }] });
  const removeRow = (id: string) => onChange({ headers: rows.filter((r) => r.id !== id) });

  return (
    <div className="tab-pane">
      <div className="lib-section">Connection headers</div>
      <div className="kv-list">
        {rows.length === 0 && <div className="auth-note">No custom headers. Add one to send it on the upgrade request.</div>}
        {rows.map((r) => (
          <div className="kv-row" key={r.id}>
            <input
              className="kv-k"
              value={r.k}
              placeholder="Header"
              spellCheck={false}
              onChange={(e) => setRow(r.id, { k: e.target.value })}
            />
            <input
              className="kv-v mono"
              value={r.v}
              placeholder="Value"
              spellCheck={false}
              onChange={(e) => setRow(r.id, { v: e.target.value })}
            />
            <button className="icon-btn sm" title="Remove header" onClick={() => removeRow(r.id)}>
              <IconTrash size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-secondary xs add-row" onClick={addRow}>
        <IconPlus size={14} /> Add header
      </button>
    </div>
  );
}

export function AuthPane({ meta, onChange }: PaneProps) {
  const bearer = meta.authType === "bearer";
  return (
    <div className="tab-pane">
      <div className="lib-section">Authorization</div>
      <div className="field">
        <label>Type</label>
        <div className="seg">
          <button className={"seg-btn" + (meta.authType === "none" ? " on" : "")} onClick={() => onChange({ authType: "none" })}>
            None
          </button>
          <button className={"seg-btn" + (bearer ? " on" : "")} onClick={() => onChange({ authType: "bearer" })}>
            Bearer token <IconChevron size={12} />
          </button>
        </div>
      </div>
      {bearer && (
        <div className="field">
          <label>Token</label>
          <input
            className="input mono"
            value={meta.authToken}
            placeholder="atk_live_…  or  {{token}}"
            spellCheck={false}
            onChange={(e) => onChange({ authToken: e.target.value })}
          />
        </div>
      )}
      <div className="auth-note">
        {bearer ? (
          <>
            Sent as <span className="mono">Authorization: Bearer …</span> on the upgrade request. A{" "}
            <span className="mono">{"{{token}}"}</span> secret stays literal in the UI and is resolved in Rust at connect.
          </>
        ) : (
          <>No Authorization header is added. Use the Headers tab for custom headers.</>
        )}
      </div>
    </div>
  );
}

// Settings pane (F18): mostly DISPLAY-ONLY like the prototype. Only two controls are
// live in v1 — auto-reconnect on/off and the per-connection insecure-TLS toggle. The
// heartbeat / backoff / coalesce / buffer values are hardcoded defaults shown as
// read-only labels (no editable controls, validation, or persistence).
export function SettingsPane({ meta, onChange }: PaneProps) {
  return (
    <div className="tab-pane">
      <div className="lib-section">Connection settings</div>

      <div className="set-row">
        <span>Auto-reconnect</span>
        <button
          className={"toggle" + (meta.reconnect ? " on" : "")}
          aria-pressed={meta.reconnect}
          title="Reconnect automatically after a dropped socket (capped 30s backoff)"
          onClick={() => onChange({ reconnect: !meta.reconnect })}
        >
          <span className="knob"></span>
        </button>
      </div>

      <div className="set-row">
        <span>
          Disable TLS verification
          {meta.insecureTls && <span className="tls-badge">MITM RISK</span>}
        </span>
        <button
          className={"toggle" + (meta.insecureTls ? " on danger" : "")}
          aria-pressed={meta.insecureTls}
          title="Turn OFF all certificate/hostname checks for this connection (footgun)"
          onClick={() => onChange({ insecureTls: !meta.insecureTls })}
        >
          <span className="knob"></span>
        </button>
      </div>
      {meta.insecureTls && (
        <div className="auth-note danger-note">
          All certificate, expiry, and hostname checks are OFF for this connection — it is fully exposed to
          man-in-the-middle interception. Use only for a trusted self-signed dev endpoint. You are re-warned at
          every connect.
        </div>
      )}

      <div className="set-row">
        <span>Heartbeat interval</span>
        <span className="mono set-val">30 s</span>
      </div>
      <div className="set-row">
        <span>Reconnect backoff</span>
        <span className="mono set-val">exponential · max 30 s</span>
      </div>
      <div className="set-row">
        <span>Frame coalescing</span>
        <span className="mono set-val">~80 ms</span>
      </div>
      <div className="set-row">
        <span>Max log buffer</span>
        <span className="mono set-val">400 frames</span>
      </div>
    </div>
  );
}
