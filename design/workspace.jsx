// workspace.jsx — connection bar + live log + composer (right pane). Exports to window.
const { useState: useWS, useRef: useRefWS, useEffect: useEffWS, useMemo: useMemoWS } = React;

// ---- frame summary --------------------------------------------------------
function frameSummary(f) {
  const b = f.body || {};
  if (b.action) return b.action + (b.channel ? " · " + b.channel : b.market ? " · " + b.market : "");
  if (b.ch) return b.ch;
  if (b.severity) return (b.severity + " · " + (b.bot || "")).trim();
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
const KIND_CLASS = {
  telemetry: "pond", alert: "flare", ack: "leaf", pong: "neutral",
  open: "rust", event: "rust", tick: "solar", error: "flare",
};

// ---- one log row ----------------------------------------------------------
function LogRow({ f, dense, fmt }) {
  const [open, setOpen] = useWS(false);
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
        <span className="log-caret"><IconChevron size={13} open={open} /></span>
      </div>
      {open && <div className="log-body"><FormatView value={f.body} fmt={fmt} /></div>}
    </div>
  );
}

// ---- log panes ------------------------------------------------------------
function LogStream({ frames, dense, split, fmt }) {
  const ref = useRefWS(null);
  const stick = useRefWS(true);
  useEffWS(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [frames.length]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  if (split) {
    const out = frames.filter((f) => f.dir === "out");
    const inc = frames.filter((f) => f.dir !== "out");
    return (
      <div className="log-split">
        <div className="log-col">
          <div className="log-col-head"><IconArrowUp size={13} /> Sent <span>{out.length}</span></div>
          <div className="log-scroll" ref={ref} onScroll={onScroll}>
            {out.map((f) => <LogRow key={f.id} f={f} dense={dense} fmt={fmt} />)}
            {out.length === 0 && <div className="empty-sm">No messages sent yet.</div>}
          </div>
        </div>
        <div className="log-col">
          <div className="log-col-head"><IconArrowDown size={13} /> Received <span>{inc.length}</span></div>
          <div className="log-scroll alt" ref={ref} onScroll={onScroll}>
            {inc.map((f) => <LogRow key={f.id} f={f} dense={dense} fmt={fmt} />)}
            {inc.length === 0 && <div className="empty-sm">Waiting for server frames…</div>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="log-scroll" ref={ref} onScroll={onScroll}>
      {frames.map((f) => <LogRow key={f.id} f={f} dense={dense} fmt={fmt} />)}
    </div>
  );
}

// ---- connection bar -------------------------------------------------------
function ConnectionBar({ item, status, elapsed, onConnect, onDisconnect, onUrl, env }) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  const hasTokens = /\{\{\s*[\w.-]+\s*\}\}/.test(item.url);
  const resolved = hasTokens ? resolveEnv(item.url, env) : null;
  return (
    <div className="conn-bar">
      <span className={"proto-chip " + item.kind}>{item.kind === "ws" ? "WSS" : item.method}</span>
      <div className="url-field">
        <input className="url-input" value={item.url} onChange={(e) => onUrl(e.target.value)} spellCheck="false" />
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
        {connected ? "Connected" : connecting ? "Connecting…" : "Disconnected"}
        {connected && <span className="status-timer">{fmtDur(elapsed)}</span>}
      </div>
      {connected || connecting
        ? <button className="btn btn-secondary" onClick={onDisconnect}><IconPlug size={15} /> Disconnect</button>
        : <button className="btn btn-rust" onClick={onConnect}><IconBolt size={15} /> Connect</button>}
    </div>
  );
}

// ---- composer -------------------------------------------------------------
function Composer({ draft, setDraft, connected, onSend, fmt, onFmt }) {
  const valid = useMemoWS(() => {
    if (!draft.trim()) return { ok: false, err: "Empty" };
    try { parseFmt(draft, fmt); return { ok: true }; }
    catch (e) { return { ok: false, err: e.message.replace(/^JSON.parse:?\s*/i, "") }; }
  }, [draft, fmt]);
  const format = () => { try { setDraft(serialize(parseFmt(draft, fmt), fmt)); } catch (e) {} };
  const send = () => { if (valid.ok && connected) { onSend(parseFmt(draft, fmt)); } };
  const bytes = new Blob([draft]).size;
  return (
    <div className="composer">
      <div className="composer-head">
        <span className="pane-title sm">Compose message</span>
        <div className="seg fmt-seg sm">
          {[["json", "JSON"], ["yaml", "YAML"], ["xml", "XML"], ["text", "Text"]].map(([k, l]) => (
            <button key={k} className={"seg-btn" + (fmt === k ? " on" : "")} onClick={() => onFmt(k)}>{l}</button>
          ))}
        </div>
        <div className="pane-head-spacer"></div>
        <span className={"valid-badge " + (valid.ok ? "ok" : "bad")}>
          {valid.ok ? <><IconCheck size={12} /> Valid {fmt.toUpperCase()}</> : <><IconX size={12} /> {valid.err}</>}
        </span>
        <button className="icon-btn xs" title="Format / tidy" onClick={format}><IconBolt size={14} /></button>
      </div>
      <textarea className="composer-input" value={draft} spellCheck="false"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }} />
      <div className="composer-foot">
        <span className="composer-hint">{bytes} B · {fmt.toUpperCase()} · ⌘↵ to send</span>
        <div className="pane-head-spacer"></div>
        <button className="btn btn-rust" disabled={!valid.ok || !connected} onClick={send}>
          <IconSend size={15} /> Send message
        </button>
      </div>
    </div>
  );
}

// ---- HTTP workspace (multi-protocol demo) ---------------------------------
function HttpWorkspace({ item }) {
  const [sent, setSent] = useWS(false);
  const [loading, setLoading] = useWS(false);
  const fire = () => { setLoading(true); setSent(false); setTimeout(() => { setLoading(false); setSent(true); }, 650); };
  const resBody = item.method === "GET"
    ? { bots: 42, online: 40, snapshotTs: Math.floor(Date.now() / 1000), totals: { kwh: 1284902, co2e_t: 1240 } }
    : { ok: true, scenarioId: "SC-7741", queued: true, etaSeconds: 18 };
  return (
    <div className="http-ws">
      <div className="conn-bar">
        <span className={"proto-chip http m-" + item.method}>{item.method}</span>
        <input className="url-input" defaultValue={item.url} spellCheck="false" />
        <button className="btn btn-rust" onClick={fire}>{loading ? "Sending…" : "Send"}<IconSend size={15} /></button>
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
        <div className="lib-section">Response{sent && <span className="resp-meta">200 OK · 312 ms · 184 B</span>}</div>
        {sent ? <div className="http-resp"><JsonView value={resBody} /></div>
          : <div className="empty-sm">Send the request to see a response.</div>}
      </div>
    </div>
  );
}

Object.assign(window, { ConnectionBar, LogStream, Composer, HttpWorkspace });
