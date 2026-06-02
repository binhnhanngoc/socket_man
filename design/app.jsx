// app.jsx — orchestrates state, the live WS simulation, layout, and Tweaks.
const { useState: uS, useRef: uR, useEffect: uE, useMemo: uM } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "dark": false,
  "accent": "#C44D1E",
  "logLayout": "unified"
}/*EDITMODE-END*/;

let FRAME_SEQ = 0;
const MAX_FRAMES = 400;

// ---- workspace toolbar + ws workspace -------------------------------------
function WsWorkspace({ item, conn, paused, onConnect, onDisconnect, onUrl, onSend,
                       onClear, onTogglePause, draft, setDraft, fmt, onFmt, split, dense, now, env }) {
  const [tab, setTab] = uS("messages");
  const [filter, setFilter] = uS("all");
  const status = conn.status;
  const connected = status === "connected";
  const elapsed = connected && conn.connectedAt ? now - conn.connectedAt : 0;
  const frames = uM(() => {
    if (filter === "sent") return conn.frames.filter((f) => f.dir === "out");
    if (filter === "recv") return conn.frames.filter((f) => f.dir !== "out");
    return conn.frames;
  }, [conn.frames, filter]);

  return (
    <div className="workspace">
      <ConnectionBar item={item} status={status} elapsed={elapsed}
        onConnect={onConnect} onDisconnect={onDisconnect} onUrl={onUrl} env={env} />
      <div className="ws-tabs">
        {["messages", "headers", "auth", "settings"].map((t) => (
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
              {[["all", "All"], ["sent", "Sent"], ["recv", "Received"]].map(([k, l]) => (
                <button key={k} className={"seg-btn" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <div className="pane-head-spacer"></div>
            <div className="seg fmt-seg">
              {[["json", "JSON"], ["yaml", "YAML"], ["xml", "XML"], ["text", "Text"]].map(([k, l]) => (
                <button key={k} className={"seg-btn" + (fmt === k ? " on" : "")} onClick={() => onFmt(k)}>{l}</button>
              ))}
            </div>
            <span className="rate-tag">{connected ? <><span className="conn-dot live"></span> streaming</> : "idle"}</span>
            <button className={"icon-btn sm" + (paused ? " on" : "")} title={paused ? "Resume" : "Pause stream"} onClick={onTogglePause}>
              {paused ? <IconBolt size={15} /> : <IconPause size={15} />}
            </button>
            <button className="icon-btn sm" title="Clear log" onClick={onClear}><IconTrash size={15} /></button>
          </div>
          {conn.frames.length === 0 && !connected
            ? <div className="ws-empty">
                <div className="ws-empty-mark"><IconRadio size={30} /></div>
                <div className="ws-empty-title">Not connected</div>
                <div className="ws-empty-sub">Connect to <span className="mono">{item.url.replace("wss://", "")}</span> to start the live message stream, then fire a saved message.</div>
              </div>
            : <LogStream frames={frames} dense={dense} split={split} fmt={fmt} />}
        </>
      )}
      {tab === "headers" && <HeadersPane />}
      {tab === "auth" && <AuthPane />}
      {tab === "settings" && <SettingsPane />}

      {tab === "messages" && (
        <Composer draft={draft} setDraft={setDraft} connected={connected} onSend={onSend} fmt={fmt} onFmt={onFmt} />
      )}
    </div>
  );
}

function KV({ k, v, mono }) {
  return (
    <div className="kv-row">
      <input className="kv-k" defaultValue={k} spellCheck="false" />
      <input className={"kv-v" + (mono ? " mono" : "")} defaultValue={v} spellCheck="false" />
    </div>
  );
}
function HeadersPane() {
  return (
    <div className="tab-pane">
      <div className="lib-section">Connection headers</div>
      <div className="kv-list">
        <KV k="Authorization" v="Bearer atk_live_8f2a…c91" mono />
        <KV k="Sec-WebSocket-Protocol" v="relay.v3" />
        <KV k="Origin" v="https://app.atomiton.io" />
        <KV k="X-Plant-Id" v="lehigh-valley" mono />
      </div>
      <button className="btn btn-secondary xs add-row"><IconPlus size={14} /> Add header</button>
    </div>
  );
}
function AuthPane() {
  return (
    <div className="tab-pane">
      <div className="lib-section">Authorization</div>
      <div className="field"><label>Type</label>
        <div className="fake-select">Bearer token <IconChevron size={14} /></div></div>
      <div className="field"><label>Token</label>
        <input className="input mono" defaultValue="atk_live_8f2a4d…91c0" spellCheck="false" /></div>
      <div className="auth-note">Token is sent in the <span className="mono">Authorization</span> header on the upgrade request.</div>
    </div>
  );
}
function SettingsPane() {
  return (
    <div className="tab-pane">
      <div className="lib-section">Connection settings</div>
      <div className="set-row"><span>Auto-reconnect</span><span className="toggle on"><span className="knob"></span></span></div>
      <div className="set-row"><span>Heartbeat interval</span><span className="mono set-val">30 s</span></div>
      <div className="set-row"><span>Reconnect backoff</span><span className="mono set-val">exponential · max 30 s</span></div>
      <div className="set-row"><span>Max log buffer</span><span className="mono set-val">400 frames</span></div>
      <div className="set-row"><span>Pretty-print incoming</span><span className="toggle on"><span className="knob"></span></span></div>
    </div>
  );
}

// ---- draggable column resizer ---------------------------------------------
function Resizer({ onResize, onReset, label }) {
  const [drag, setDrag] = uS(false);
  const last = uR(0);
  const onDown = (e) => {
    e.preventDefault();
    last.current = e.clientX;
    setDrag(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev) => { onResize(ev.clientX - last.current); last.current = ev.clientX; };
    const up = () => {
      setDrag(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div className={"resizer" + (drag ? " dragging" : "")} onMouseDown={onDown}
      onDoubleClick={onReset} role="separator" aria-orientation="vertical"
      title={(label || "Drag to resize") + " · double-click to reset"}></div>
  );
}

// ---- App ------------------------------------------------------------------
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // unique id helper for duplicated nodes
  const uid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---- collection tree (editable: rename / duplicate / add) ---------------
  const [collections, setCollections] = uS(() => {
    try { const s = localStorage.getItem("relay.collections"); if (s) return JSON.parse(s); } catch (e) {}
    // migrate from earlier name-override storage
    let cn = {}, iN = {};
    try { cn = JSON.parse(localStorage.getItem("relay.collNames") || "{}"); } catch (e) {}
    try { iN = JSON.parse(localStorage.getItem("relay.itemNames") || "{}"); } catch (e) {}
    return COLLECTIONS.map((c) => ({
      ...c, name: cn[c.id] || c.name,
      items: c.items.map((it) => ({ ...it, name: iN[it.id] || it.name })),
    }));
  });
  const persistColls = (next) => {
    setCollections(next);
    try { localStorage.setItem("relay.collections", JSON.stringify(next)); } catch (e) {}
  };
  const allItems = uM(() => collections.flatMap((c) => c.items), [collections]);

  const [msgCollNames, setMsgCollNames] = uS(() => {
    try { return JSON.parse(localStorage.getItem("relay.msgCollNames") || "{}"); } catch (e) { return {}; }
  });
  const renameMsgColl = (id, name) => setMsgCollNames((p) => {
    const n = { ...p, [id]: name };
    try { localStorage.setItem("relay.msgCollNames", JSON.stringify(n)); } catch (e) {}
    return n;
  });
  const renameColl = (id, name) => persistColls(collections.map((c) => (c.id === id ? { ...c, name } : c)));
  const renameItem = (id, name) => persistColls(collections.map((c) => ({
    ...c, items: c.items.map((it) => (it.id === id ? { ...it, name } : it)),
  })));
  const [activeId, setActiveId] = uS("ws-live");
  const [conns, setConns] = uS(() => {
    const o = {};
    allItems.forEach((it) => { if (it.kind === "ws") o[it.id] = { status: "disconnected", frames: [], connectedAt: null }; });
    return o;
  });
  const [urls, setUrls] = uS(() => Object.fromEntries(allItems.map((i) => [i.id, i.url])));
  const [paused, setPaused] = uS(false);
  const [draft, setDraft] = uS('{\n  "action": "subscribe",\n  "channel": "boiler.3",\n  "fields": ["kwh", "temp_c", "efficiency"]\n}');
  const [now, setNow] = uS(Date.now());
  const [msgs, setMsgs] = uS(() => JSON.parse(JSON.stringify(MESSAGES)));
  const [fmt, setFmt] = uS("json");
  const servers = uR({});

  // ---- environments -------------------------------------------------------
  const [environments, setEnvironments] = uS(() => {
    try { const s = localStorage.getItem("relay.environments"); if (s) return JSON.parse(s); } catch (e) {}
    return ENVIRONMENTS;
  });
  const [activeEnvId, setActiveEnvId] = uS(() => {
    try { const s = localStorage.getItem("relay.activeEnv"); if (s !== null) return s === "" ? null : s; } catch (e) {}
    return "env-prod";
  });
  const [editEnv, setEditEnv] = uS(null); // { id, isNew }
  const persistEnvs = (next) => {
    setEnvironments(next);
    try { localStorage.setItem("relay.environments", JSON.stringify(next)); } catch (e) {}
  };
  const switchEnv = (id) => {
    setActiveEnvId(id);
    try { localStorage.setItem("relay.activeEnv", id == null ? "" : id); } catch (e) {}
  };
  const addEnv = () => {
    const id = "env-" + Date.now();
    const env = { id, name: "New environment", color: "rust",
      vars: [{ id: "v" + Date.now(), key: "", value: "", secret: false }] };
    persistEnvs([...environments, env]);
    setEditEnv({ id, isNew: true });
  };
  const saveEnv = (updated) => persistEnvs(environments.map((e) => (e.id === updated.id ? updated : e)));
  const deleteEnv = (id) => {
    const next = environments.filter((e) => e.id !== id);
    persistEnvs(next);
    if (activeEnvId === id) switchEnv(next[0] ? next[0].id : null);
    setEditEnv(null);
  };
  const cancelNewEnv = (id, isNew) => {
    // a brand-new env that was opened then cancelled with no real edits is discarded
    if (isNew) {
      const e = environments.find((x) => x.id === id);
      const empty = e && e.name === "New environment" && (e.vars || []).every((v) => !v.key.trim() && !v.value.trim());
      if (empty) { persistEnvs(environments.filter((x) => x.id !== id)); }
    }
    setEditEnv(null);
  };
  const activeEnv = environments.find((e) => e.id === activeEnvId) || null;
  const editingEnv = editEnv ? environments.find((e) => e.id === editEnv.id) : null;

  const activeItem = allItems.find((i) => i.id === activeId);
  const activeItemWithUrl = activeItem
    ? { ...activeItem, url: urls[activeItem.id] || activeItem.url }
    : null;
  const activeConn = activeItem && activeItem.kind === "ws" ? conns[activeId] : null;

  const addFrames = (connId, arr) => {
    setConns((prev) => {
      const c = prev[connId]; if (!c) return prev;
      const next = arr.map((f) => ({ id: ++FRAME_SEQ, ts: Date.now(), size: byteSize(f.body), ...f }));
      let frames = c.frames.concat(next);
      if (frames.length > MAX_FRAMES) frames = frames.slice(frames.length - MAX_FRAMES);
      return { ...prev, [connId]: { ...c, frames } };
    });
  };

  // live tick: server-initiated frames for the active connected socket + clock
  uE(() => {
    const iv = setInterval(() => {
      setNow(Date.now());
      const c = conns[activeId];
      if (!paused && c && c.status === "connected" && servers.current[activeId]) {
        const f = servers.current[activeId].tick();
        if (f.length) addFrames(activeId, f);
      }
    }, 1200);
    return () => clearInterval(iv);
  }, [activeId, conns, paused]);

  const connect = (id) => {
    setConns((p) => ({ ...p, [id]: { ...p[id], status: "connecting" } }));
    setTimeout(() => {
      servers.current[id] = makeServer(id);
      setConns((p) => ({ ...p, [id]: { ...p[id], status: "connected", connectedAt: Date.now() } }));
      addFrames(id, [{ dir: "in", ...servers.current[id].welcome() }]);
    }, 620);
  };
  const disconnect = (id) => {
    if (servers.current[id]) servers.current[id].subs.clear();
    addFrames(id, [{ dir: "sys", kind: "closed", body: { reason: "client disconnect", code: 1000 } }]);
    setConns((p) => ({ ...p, [id]: { ...p[id], status: "disconnected", connectedAt: null } }));
  };
  const sendBody = (id, body) => {
    addFrames(id, [{ dir: "out", kind: body.action || "message", body }]);
    const srv = servers.current[id];
    if (srv) {
      const replies = srv.handle(body);
      setTimeout(() => addFrames(id, replies.map((r) => ({ dir: "in", ...r }))), 240);
    }
  };
  const sendSaved = (msg) => { setDraft(serialize(msg.body, fmt)); if (activeConn && activeConn.status === "connected") sendBody(activeId, msg.body); };
  const loadSaved = (msg) => setDraft(serialize(msg.body, fmt));
  const renameMsg = (msgId, name) => setMsgs((p) => ({
    ...p, [activeId]: (p[activeId] || []).map((m) => (m.id === msgId ? { ...m, name } : m)),
  }));

  // ---- duplicate: collection / endpoint / message -------------------------
  const ensureWsState = (origId, newId, srcUrl) => {
    setUrls((p) => ({ ...p, [newId]: p[origId] || srcUrl }));
    setConns((p) => ({ ...p, [newId]: { status: "disconnected", frames: [], connectedAt: null } }));
    setMsgs((p) => ({ ...p, [newId]: JSON.parse(JSON.stringify(p[origId] || MESSAGES[origId] || [])) }));
  };
  const dupItemObj = (it) => {
    const nid = uid(it.kind);
    if (it.kind === "ws") ensureWsState(it.id, nid, it.url);
    else setUrls((p) => ({ ...p, [nid]: p[it.id] || it.url }));
    return { ...it, id: nid };
  };
  const duplicateCollection = (id) => {
    const idx = collections.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const src = collections[idx];
    const copy = { ...src, id: uid("c"), name: src.name + " copy", items: src.items.map(dupItemObj) };
    persistColls([...collections.slice(0, idx + 1), copy, ...collections.slice(idx + 1)]);
  };
  const duplicateItem = (id) => {
    let ci = -1, ii = -1;
    collections.forEach((c, x) => { const y = c.items.findIndex((it) => it.id === id); if (y >= 0) { ci = x; ii = y; } });
    if (ci < 0) return;
    const src = collections[ci].items[ii];
    const nid = uid(src.kind);
    if (src.kind === "ws") ensureWsState(src.id, nid, src.url);
    else setUrls((p) => ({ ...p, [nid]: p[src.id] || src.url }));
    const copy = { ...src, id: nid, name: src.name + " copy" };
    persistColls(collections.map((c, x) => (x !== ci ? c : { ...c, items: [...c.items.slice(0, ii + 1), copy, ...c.items.slice(ii + 1)] })));
    setActiveId(nid);
    setActiveMsgId(null);
  };
  const duplicateMsg = (msgId) => setMsgs((p) => {
    const list = p[activeId] || [];
    const idx = list.findIndex((m) => m.id === msgId);
    if (idx < 0) return p;
    const copy = { ...list[idx], id: uid("m"), name: list[idx].name + " copy", fav: false };
    return { ...p, [activeId]: [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)] };
  });
  const [activeMsgId, setActiveMsgId] = uS(null);
  // switch view format, converting the current draft when it parses cleanly
  const changeFmt = (next) => {
    if (next === fmt) return;
    try { const obj = parseFmt(draft, fmt); setDraft(serialize(obj, next)); } catch (e) {}
    setFmt(next);
  };

  const statuses = uM(() => Object.fromEntries(Object.entries(conns).map(([k, v]) => [k, v.status])), [conns]);
  const dense = t.density === "compact";

  // ---- resizable panels ---------------------------------------------------
  const SIDEBAR_DEF = 260, LIBRARY_DEF = 332;
  const readW = (k, d) => { try { const v = parseInt(localStorage.getItem(k), 10); if (!isNaN(v)) return v; } catch (e) {} return d; };
  const [sidebarW, setSidebarW] = uS(() => readW("relay.sidebarW", SIDEBAR_DEF));
  const [libraryW, setLibraryW] = uS(() => readW("relay.libraryW", LIBRARY_DEF));
  const [sidebarCollapsed, setSidebarCollapsed] = uS(() => {
    try { return localStorage.getItem("relay.sidebarCollapsed") === "1"; } catch (e) { return false; }
  });
  const toggleSidebar = () => setSidebarCollapsed((v) => {
    try { localStorage.setItem("relay.sidebarCollapsed", v ? "0" : "1"); } catch (e) {}
    return !v;
  });
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const resizeSidebar = (dx) => setSidebarW((w) => { const n = clamp(w + dx, 200, 440); try { localStorage.setItem("relay.sidebarW", n); } catch (e) {} return n; });
  const resizeLibrary = (dx) => setLibraryW((w) => { const n = clamp(w + dx, 248, 600); try { localStorage.setItem("relay.libraryW", n); } catch (e) {} return n; });
  const resetSidebar = () => { setSidebarW(SIDEBAR_DEF); try { localStorage.setItem("relay.sidebarW", SIDEBAR_DEF); } catch (e) {} };
  const resetLibrary = () => { setLibraryW(LIBRARY_DEF); try { localStorage.setItem("relay.libraryW", LIBRARY_DEF); } catch (e) {} };

  return (
    <div className={"app" + (t.dark ? " dark" : "")} data-density={t.density}
         style={{ "--accent": t.accent }}>
      <TopNav accent={t.accent} dark={t.dark} onToggleDark={() => setTweak("dark", !t.dark)}
        environments={environments} activeEnv={activeEnv}
        onSwitchEnv={switchEnv} onEditEnv={(id) => setEditEnv({ id, isNew: false })} onAddEnv={addEnv} />
      <div className="app-body">
        <CollectionsSidebar collections={collections} activeId={activeId} width={sidebarW}
          collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar}
          onSelect={(id) => { setActiveId(id); setActiveMsgId(null); }} statuses={statuses}
          onRename={renameColl} onRenameItem={renameItem}
          onDuplicateColl={duplicateCollection} onDuplicateItem={duplicateItem} />
        {!sidebarCollapsed && <Resizer onResize={resizeSidebar} onReset={resetSidebar} label="Resize sidebar" />}

        {activeItemWithUrl && activeItemWithUrl.kind === "ws" ? (
          <>
            <MessageLibrary item={activeItemWithUrl} messages={msgs[activeId]} width={libraryW}
              connected={activeConn && activeConn.status === "connected"}
              collectionName={msgCollNames[activeId] || "Messages"}
              onRename={(name) => renameMsgColl(activeId, name)}
              onSend={(m) => { setActiveMsgId(m.id); sendSaved(m); }}
              onLoad={(m) => { setActiveMsgId(m.id); loadSaved(m); }}
              onReorder={(next) => setMsgs((p) => ({ ...p, [activeId]: next }))}
              onRenameMsg={renameMsg} onDuplicateMsg={duplicateMsg}
              activeMsgId={activeMsgId} />
            <Resizer onResize={resizeLibrary} onReset={resetLibrary} label="Resize messages" />
            <WsWorkspace item={activeItemWithUrl} conn={activeConn} paused={paused} now={now}
              onConnect={() => connect(activeId)} onDisconnect={() => disconnect(activeId)}
              onUrl={(v) => setUrls((p) => ({ ...p, [activeId]: v }))}
              onSend={(b) => sendBody(activeId, b)}
              onClear={() => setConns((p) => ({ ...p, [activeId]: { ...p[activeId], frames: [] } }))}
              onTogglePause={() => setPaused((x) => !x)}
              draft={draft} setDraft={setDraft} fmt={fmt} onFmt={changeFmt}
              split={t.logLayout === "split"} dense={dense} env={activeEnv} />
          </>
        ) : (
          <HttpWorkspace item={activeItemWithUrl} />
        )}
      </div>

      {editingEnv && (
        <EnvEditor env={editingEnv} isNew={editEnv.isNew}
          onSave={saveEnv} onDelete={deleteEnv}
          onClose={() => cancelNewEnv(editEnv.id, editEnv.isNew)} />
      )}

      <TweaksPanel>
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "comfortable"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakRadio label="Log layout" value={t.logLayout} options={["unified", "split"]}
          onChange={(v) => setTweak("logLayout", v)} />
        <TweakSection label="Theme" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakColor label="Accent" value={t.accent}
          options={["#C44D1E", "#3F6B72", "#5D7A3C", "#8B5A3C"]}
          onChange={(v) => setTweak("accent", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
