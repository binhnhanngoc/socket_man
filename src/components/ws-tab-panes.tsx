// WS workspace tabs: Headers / Auth / Settings panes. Ported from design/app.jsx.
// These are STATIC display panes in Phase 1 (visual parity). Phase 2 wires
// Headers/Auth into ConnectConfig.headers (the Authorization-on-upgrade path);
// Phase 3 makes Settings display-only for the hardcoded reliability defaults.
import { IconPlus, IconChevron } from "./icons";

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="kv-row">
      <input className="kv-k" defaultValue={k} spellCheck={false} />
      <input className={"kv-v" + (mono ? " mono" : "")} defaultValue={v} spellCheck={false} />
    </div>
  );
}

export function HeadersPane() {
  return (
    <div className="tab-pane">
      <div className="lib-section">Connection headers</div>
      <div className="kv-list">
        <KV k="Authorization" v="Bearer atk_live_8f2a…c91" mono />
        <KV k="Sec-WebSocket-Protocol" v="relay.v3" />
        <KV k="Origin" v="https://app.atomiton.io" />
        <KV k="X-Plant-Id" v="lehigh-valley" mono />
      </div>
      <button className="btn btn-secondary xs add-row">
        <IconPlus size={14} /> Add header
      </button>
    </div>
  );
}

export function AuthPane() {
  return (
    <div className="tab-pane">
      <div className="lib-section">Authorization</div>
      <div className="field">
        <label>Type</label>
        <div className="fake-select">
          Bearer token <IconChevron size={14} />
        </div>
      </div>
      <div className="field">
        <label>Token</label>
        <input className="input mono" defaultValue="atk_live_8f2a4d…91c0" spellCheck={false} />
      </div>
      <div className="auth-note">
        Token is sent in the <span className="mono">Authorization</span> header on the upgrade request.
      </div>
    </div>
  );
}

export function SettingsPane() {
  return (
    <div className="tab-pane">
      <div className="lib-section">Connection settings</div>
      <div className="set-row">
        <span>Auto-reconnect</span>
        <span className="toggle on">
          <span className="knob"></span>
        </span>
      </div>
      <div className="set-row">
        <span>Heartbeat interval</span>
        <span className="mono set-val">30 s</span>
      </div>
      <div className="set-row">
        <span>Reconnect backoff</span>
        <span className="mono set-val">exponential · max 30 s</span>
      </div>
      <div className="set-row">
        <span>Max log buffer</span>
        <span className="mono set-val">400 frames</span>
      </div>
      <div className="set-row">
        <span>Pretty-print incoming</span>
        <span className="toggle on">
          <span className="knob"></span>
        </span>
      </div>
    </div>
  );
}
