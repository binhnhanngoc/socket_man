// WS workspace: connection bar + tabbed message log / headers / auth / settings
// + composer. Ported from design/app.jsx (WsWorkspace).
import { useMemo, useState } from "react";
import type { ConnMeta, Environment, Item, ConnState } from "../types";
import type { Format } from "../formats/serialize";
import { ConnectionBar } from "./connection-bar";
import { LogStream } from "./log-stream";
import { LogFilterBar } from "./log-filter-bar";
import { Composer } from "./composer";
import { HeadersPane, AuthPane, SettingsPane } from "./ws-tab-panes";
import { IconBolt, IconPause, IconTrash, IconRadio, IconDownload } from "./icons";
import { saveFrameLog } from "../lib/export-file";
import { useLogFilter, applyLogFilter } from "../hooks/use-log-filter";

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

const TABS: Tab[] = ["messages", "headers", "auth", "settings"];
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
  const filter = useLogFilter();
  const status = conn.status;
  const connected = status === "connected";
  const elapsed = connected && conn.connectedAt ? now - conn.connectedAt : 0;
  const frames = useMemo(
    () => applyLogFilter(conn.frames, filter.dirs, filter.text),
    [conn.frames, filter.dirs, filter.text]
  );

  return (
    <div className="workspace">
      <ConnectionBar
        item={item}
        status={status}
        elapsed={elapsed}
        rttMs={conn.rttMs}
        insecureTls={meta.insecureTls}
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
            <LogFilterBar
              dirs={filter.dirs}
              text={filter.text}
              active={filter.active}
              count={frames.length}
              total={conn.frames.length}
              onToggleDir={filter.toggleDir}
              onText={filter.setText}
              onClear={filter.clear}
            />
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
            <button
              className="icon-btn sm"
              title="Export visible log…"
              disabled={frames.length === 0}
              onClick={() => saveFrameLog(frames)}
            >
              <IconDownload size={15} />
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
      {tab === "headers" && <HeadersPane meta={meta} onChange={onMeta} url={item.url} env={env} />}
      {tab === "auth" && <AuthPane meta={meta} onChange={onMeta} />}
      {tab === "settings" && <SettingsPane meta={meta} onChange={onMeta} />}

      {tab === "messages" && (
        <Composer draft={draft} setDraft={setDraft} connected={connected} onSend={onSend} fmt={fmt} onFmt={onFmt} />
      )}
    </div>
  );
}
