// HTTP workspace (demo). Ported from design/workspace.jsx. Phase 4 wires this to
// the real reqwest-backed transport.httpSend; Phase 1 keeps the prototype's
// canned response so visual parity holds.
import { useState } from "react";
import type { Item } from "../types";
import { JsonView } from "../formats/json-view";
import { IconSend } from "./icons";

export function HttpWorkspace({ item }: { item: Item }) {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const fire = () => {
    setLoading(true);
    setSent(false);
    setTimeout(() => {
      setLoading(false);
      setSent(true);
    }, 650);
  };
  const resBody =
    item.method === "GET"
      ? { bots: 42, online: 40, snapshotTs: Math.floor(Date.now() / 1000), totals: { kwh: 1284902, co2e_t: 1240 } }
      : { ok: true, scenarioId: "SC-7741", queued: true, etaSeconds: 18 };
  return (
    <div className="http-ws">
      <div className="conn-bar">
        <span className={"proto-chip http m-" + item.method}>{item.method}</span>
        <input className="url-input" defaultValue={item.url} spellCheck={false} />
        <button className="btn btn-rust" onClick={fire}>
          {loading ? "Sending…" : "Send"}
          <IconSend size={15} />
        </button>
      </div>
      <div className="http-tabs">
        <button className="http-tab active">Body</button>
        <button className="http-tab">Headers</button>
        <button className="http-tab">Auth</button>
      </div>
      <div className="http-panel">
        {item.method === "POST" && (
          <div className="http-req">
            <div className="lib-section">Request body</div>
            <JsonView value={{ scenario: "A", shift: { bot: "B-021", window: "02:00-05:00" } }} />
          </div>
        )}
        <div className="lib-section">
          Response{sent && <span className="resp-meta">200 OK · 312 ms · 184 B</span>}
        </div>
        {sent ? (
          <div className="http-resp">
            <JsonView value={resBody} />
          </div>
        ) : (
          <div className="empty-sm">Send the request to see a response.</div>
        )}
      </div>
    </div>
  );
}
