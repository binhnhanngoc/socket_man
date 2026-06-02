// WS workspace: connection bar + tabbed message log / headers / auth / settings
// + composer. Ported from design/app.jsx (WsWorkspace).
import { useMemo, useState } from "react";
import type { ConnMeta, Environment, Item, ConnState } from "../types";
import type { Format } from "../formats/serialize";
import { ConnectionBar } from "./connection-bar";
import { LogStream } from "./log-stream";
import { Composer } from "./composer";
import { HeadersPane, AuthPane, SettingsPane } from "./ws-tab-panes";
import { IconBolt, IconPause, IconTrash, IconRadio } from "./icons";

interface WsWorkspaceProps {
  item: Item;
  conn: ConnState;
  paused: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onUrl: (v: string) => void;
  onSend: (body: unknown) => void;
  onClear: () => void;
  onTogglePause: () => void;
  draft: string;
  setDraft: (v: string) => void;
  fmt: Format;
  onFmt: (f: Format) => void;
  split: boolean;
  dense: boolean;
  now: number;
  env: Environment | null;
  meta: ConnMeta;
  onMeta: (patch: Partial<ConnMeta>) => void;
}

type Tab = "messages" | "headers" | "auth" | "settings";
type FilterKind = "all" | "sent" | "recv";

const TABS: Tab[] = ["messages", "headers", "auth", "settings"];
const FILTERS: [FilterKind, string][] = [
  ["all", "All"],
  ["sent", "Sent"],
  ["recv", "Received"],
];
const FORMATS: [Format, string][] = [
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["xml", "XML"],
  ["text", "Text"],
];

export function WsWorkspace(props: WsWorkspaceProps) {
  const { item, conn, paused, onConnect, onDisconnect, onUrl, onSend, onClear, onTogglePause } = props;
  const { draft, setDraft, fmt, onFmt, split, dense, now, env, meta, onMeta } = props;
  const [tab, setTab] = useState<Tab>("messages");
  const [filter, setFilter] = useState<FilterKind>("all");
  const status = conn.status;
  const connected = status === "connected";
  const elapsed = connected && conn.connectedAt ? now - conn.connectedAt : 0;
  const frames = useMemo(() => {
    if (filter === "sent") return conn.frames.filter((f) => f.dir === "out");
    if (filter === "recv") return conn.frames.filter((f) => f.dir !== "out");
    return conn.frames;
  }, [conn.frames, filter]);

  return (
    <div className="workspace">
      <ConnectionBar
        item={item}
        status={status}
        elapsed={elapsed}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onUrl={onUrl}
        env={env}
      />
      <div className="ws-tabs">
        {TABS.map((t) => (
          <button key={t} className={"ws-tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
            {t === "messages" ? "Message log" : t[0].toUpperCase() + t.slice(1)}
            {t === "messages" && conn.frames.length > 0 && <span className="tab-count">{conn.frames.length}</span>}
          </button>
        ))}
      </div>

      {tab === "messages" && (
        <>
          <div className="log-toolbar">
            <div className="seg">
              {FILTERS.map(([k, l]) => (
                <button key={k} className={"seg-btn" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="pane-head-spacer"></div>
            <div className="seg fmt-seg">
              {FORMATS.map(([k, l]) => (
                <button key={k} className={"seg-btn" + (fmt === k ? " on" : "")} onClick={() => onFmt(k)}>
                  {l}
                </button>
              ))}
            </div>
            <span className="rate-tag">
              {connected ? (
                <>
                  <span className="conn-dot live"></span> streaming
                </>
              ) : (
                "idle"
              )}
            </span>
            <button
              className={"icon-btn sm" + (paused ? " on" : "")}
              title={paused ? "Resume" : "Pause stream"}
              onClick={onTogglePause}
            >
              {paused ? <IconBolt size={15} /> : <IconPause size={15} />}
            </button>
            <button className="icon-btn sm" title="Clear log" onClick={onClear}>
              <IconTrash size={15} />
            </button>
          </div>
          {conn.frames.length === 0 && !connected ? (
            <div className="ws-empty">
              <div className="ws-empty-mark">
                <IconRadio size={30} />
              </div>
              <div className="ws-empty-title">Not connected</div>
              <div className="ws-empty-sub">
                Connect to <span className="mono">{item.url.replace("wss://", "")}</span> to start the live message
                stream, then fire a saved message.
              </div>
            </div>
          ) : (
            <LogStream frames={frames} dense={dense} split={split} fmt={fmt} />
          )}
        </>
      )}
      {tab === "headers" && <HeadersPane meta={meta} onChange={onMeta} />}
      {tab === "auth" && <AuthPane meta={meta} onChange={onMeta} />}
      {tab === "settings" && <SettingsPane />}

      {tab === "messages" && (
        <Composer draft={draft} setDraft={setDraft} connected={connected} onSend={onSend} fmt={fmt} onFmt={onFmt} />
      )}
    </div>
  );
}
