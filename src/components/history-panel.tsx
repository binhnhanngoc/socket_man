// History panel (modal): lists persisted HTTP requests + WS session summaries
// newest-first, filterable by kind, with clear-all. Clicking an entry reopens the
// originating collection item. Entries are TEMPLATE-form (no resolved secrets).
import { useState } from "react";
import type { HistoryEntry } from "../types";
import { IconX, IconTrash, IconClock } from "./icons";

type Filter = "all" | "http" | "ws";

interface Props {
  entries: HistoryEntry[];
  onReload: (e: HistoryEntry) => void;
  onClear: () => void;
  onClose: () => void;
}

function fmtTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

const FILTERS: Filter[] = ["all", "http", "ws"];

export function HistoryPanel({ entries, onReload, onClear, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const list = filter === "all" ? entries : entries.filter((e) => e.kind === filter);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal env-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-head-l">
            <IconClock size={16} />
            <span className="modal-title">History</span>
          </div>
          <button className="icon-btn sm" title="Close" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="log-toolbar">
            <div className="seg">
              {FILTERS.map((f) => (
                <button key={f} className={"seg-btn" + (filter === f ? " on" : "")} onClick={() => setFilter(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="pane-head-spacer"></div>
            <button className="btn btn-secondary xs" onClick={onClear} disabled={entries.length === 0}>
              <IconTrash size={14} /> Clear
            </button>
          </div>

          {list.length === 0 ? (
            <div className="empty-sm">No history yet. Send an HTTP request or run a WS session.</div>
          ) : (
            <div className="kv-list">
              {list.map((e) => (
                <button
                  key={e.id}
                  className="kv-row"
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "6px 4px" }}
                  onClick={() => onReload(e)}
                  title="Reopen this request"
                >
                  <span className={"proto-chip " + (e.kind === "ws" ? "ws" : "http")}>{e.kind === "ws" ? "WS" : "HTTP"}</span>
                  <span className="mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</span>
                  <span style={{ color: "var(--stone)" }}>{e.summary}</span>
                  <span style={{ color: "var(--stone)", fontSize: "0.8em" }}>{fmtTs(e.ts)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
