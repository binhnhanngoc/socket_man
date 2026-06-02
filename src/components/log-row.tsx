// One log row: collapsible frame line + expanded formatted body. Ported from
// design/workspace.jsx (LogRow + frameSummary + KIND_CLASS).
import { useState } from "react";
import { fmtTime } from "../lib/util";
import { FormatView } from "../formats/format-view";
import type { Format } from "../formats/serialize";
import type { Frame } from "../transport/transport";
import { IconArrowUp, IconArrowDown, IconChevron } from "./icons";

function frameSummary(f: Frame): string {
  const b = (f.body || {}) as Record<string, unknown>;
  if (b.action) return String(b.action) + (b.channel ? " · " + b.channel : b.market ? " · " + b.market : "");
  if (b.ch) return String(b.ch);
  if (b.severity) return (b.severity + " · " + (b.bot || "")).toString().trim();
  if (b.subscribed) return "ack · subscribed " + b.subscribed;
  if (b.unsubscribed !== undefined) return "ack · unsubscribed " + b.unsubscribed;
  if (b.pong) return "pong · " + b.rttMs + "ms";
  if (b.server) return "open · " + b.server;
  if (b.node) return b.node + " · $" + b.priceUSDMWh;
  if (b.scenario) return "scenario " + b.scenario + " · " + b.state;
  if (b.applied) return "ack · config applied";
  if (b.acknowledged) return "ack · " + b.acknowledged;
  if (b.ok) return "ack · ok";
  return f.kind;
}

const KIND_CLASS: Record<string, string> = {
  telemetry: "pond",
  alert: "flare",
  ack: "leaf",
  pong: "neutral",
  open: "rust",
  event: "rust",
  tick: "solar",
  error: "flare",
};

export function LogRow({ f, dense, fmt }: { f: Frame; dense: boolean; fmt: Format }) {
  const [open, setOpen] = useState(false);
  const out = f.dir === "out";
  const sys = f.dir === "sys";
  return (
    <div className={"log-row" + (open ? " open" : "") + (dense ? " dense" : "")} onClick={() => setOpen(!open)}>
      <div className="log-line">
        <span className={"dir " + f.dir}>
          {sys ? <span className="dir-sys">•</span> : out ? <IconArrowUp size={13} /> : <IconArrowDown size={13} />}
        </span>
        <span className="log-time">{fmtTime(f.ts)}</span>
        <span className={"kind-pill " + (KIND_CLASS[f.kind] || "neutral")}>{f.kind}</span>
        <span className="log-summary">{frameSummary(f)}</span>
        <span className="log-size">{f.size} B</span>
        <span className="log-caret">
          <IconChevron size={13} open={open} />
        </span>
      </div>
      {open && (
        <div className="log-body">
          <FormatView value={f.body} fmt={fmt} />
        </div>
      )}
    </div>
  );
}
