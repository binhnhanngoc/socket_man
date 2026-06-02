// HTTP request editor: Body / Headers tabs. Headers reuse the WS KV-row styling;
// the body is a format-aware textarea (same tidy/format affordance as the WS
// composer). Method + URL + Send live in the workspace's connection bar.
import { useState } from "react";
import type { HeaderRow } from "../types";
import { serialize, parseFmt, type Format } from "../formats/serialize";
import { IconPlus, IconTrash, IconBolt } from "./icons";

interface Props {
  hasBody: boolean;
  headers: HeaderRow[];
  addHeader: () => void;
  setHeaderRow: (id: string, patch: Partial<HeaderRow>) => void;
  removeHeader: (id: string) => void;
  body: string;
  setBody: (v: string) => void;
}

type Tab = "body" | "headers";

const FORMATS: [Format, string][] = [
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["xml", "XML"],
  ["text", "Text"],
];

export function HttpRequestEditor({ hasBody, headers, addHeader, setHeaderRow, removeHeader, body, setBody }: Props) {
  const [tab, setTab] = useState<Tab>(hasBody ? "body" : "headers");
  const [fmt, setFmt] = useState<Format>("json");
  // If the method loses its body (GET), don't leave the hidden Body tab active.
  const active: Tab = !hasBody && tab === "body" ? "headers" : tab;

  const tidy = () => {
    try {
      setBody(serialize(parseFmt(body, fmt), fmt));
    } catch {
      // leave as-is when it doesn't parse in the selected format
    }
  };

  return (
    <div className="http-req">
      <div className="http-tabs">
        {hasBody && (
          <button className={"http-tab" + (active === "body" ? " active" : "")} onClick={() => setTab("body")}>
            Body
          </button>
        )}
        <button className={"http-tab" + (active === "headers" ? " active" : "")} onClick={() => setTab("headers")}>
          Headers
          {headers.length > 0 && <span className="tab-count">{headers.length}</span>}
        </button>
      </div>

      {active === "body" && hasBody && (
        <div className="http-panel">
          <div className="composer-head">
            <span className="pane-title sm">Request body</span>
            <div className="seg fmt-seg sm">
              {FORMATS.map(([k, l]) => (
                <button key={k} className={"seg-btn" + (fmt === k ? " on" : "")} onClick={() => setFmt(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="pane-head-spacer"></div>
            <button className="icon-btn xs" title="Format / tidy" onClick={tidy}>
              <IconBolt size={14} />
            </button>
          </div>
          <textarea
            className="composer-input"
            value={body}
            spellCheck={false}
            placeholder={'{\n  "key": "value"\n}'}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      )}

      {active === "headers" && (
        <div className="http-panel">
          <div className="lib-section">Request headers</div>
          <div className="kv-list">
            {headers.length === 0 && <div className="auth-note">No headers. A {"{{secret}}"} token stays literal and resolves in Rust at send.</div>}
            {headers.map((r) => (
              <div className="kv-row" key={r.id}>
                <input
                  className="kv-k"
                  value={r.k}
                  placeholder="Header"
                  spellCheck={false}
                  onChange={(e) => setHeaderRow(r.id, { k: e.target.value })}
                />
                <input
                  className="kv-v mono"
                  value={r.v}
                  placeholder="Value"
                  spellCheck={false}
                  onChange={(e) => setHeaderRow(r.id, { v: e.target.value })}
                />
                <button className="icon-btn sm" title="Remove header" onClick={() => removeHeader(r.id)}>
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary xs add-row" onClick={addHeader}>
            <IconPlus size={14} /> Add header
          </button>
        </div>
      )}
    </div>
  );
}
