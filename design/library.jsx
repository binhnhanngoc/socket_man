// library.jsx — saved message library (middle pane), drag-to-reorder. Exports to window.
const { useState: useStateLib } = React;

const TYPE_CLASS = {
  subscribe: "leaf", config: "pond", control: "neutral", event: "rust",
};

function MessageCard({ msg, connected, onSend, onLoad, onRename, onDuplicate, active, canDrag, dragging, compact,
                       onDragStart, onDragOver, onDragEnd }) {
  const dragProps = {
    draggable: canDrag, onDragStart, onDragOver, onDragEnd, onDrop: (e) => e.preventDefault(),
  };
  const nameField = (cls) => (
    <EditableName value={msg.name} onCommit={(name) => onRename(msg.id, name)}
      renderIdle={({ begin }) => (
        <>
          <span className={cls} title="Double-click to rename"
            onDoubleClick={(e) => { e.stopPropagation(); begin(); }}>{msg.name}</span>
          <span className="msg-rename" role="button" tabIndex={-1} title="Rename message"
            onClick={(e) => { e.stopPropagation(); begin(); }}>
            <IconPencil size={11} />
          </span>
          <span className="msg-rename" role="button" tabIndex={-1} title="Duplicate message"
            onClick={(e) => { e.stopPropagation(); onDuplicate(msg.id); }}>
            <IconCopy size={11} />
          </span>
        </>
      )} />
  );
  if (compact) {
    return (
      <div className={"msg-card compact" + (active ? " active" : "") + (dragging ? " dragging" : "")}
        {...dragProps} onClick={(e) => { if (e.detail > 1) return; onLoad(msg); }}>
        {canDrag && <span className="msg-grip" title="Drag to reorder"><IconGrip size={13} /></span>}
        <span className={"type-dot " + (TYPE_CLASS[msg.type] || "neutral")} title={msg.type}></span>
        {nameField("msg-name")}
        {msg.fav && <span className="msg-fav" title="Pinned"><IconStar size={11} /></span>}
        <button className="msg-send-ico" disabled={!connected}
          onClick={(e) => { e.stopPropagation(); onSend(msg); }}
          title={connected ? "Send now" : "Connect first"}><IconSend size={13} /></button>
      </div>
    );
  }
  return (
    <div className={"msg-card" + (active ? " active" : "") + (dragging ? " dragging" : "")}
      {...dragProps} onClick={(e) => { if (e.detail > 1) return; onLoad(msg); }}>
      <div className="msg-card-top">
        {canDrag && <span className="msg-grip" title="Drag to reorder"><IconGrip size={14} /></span>}
        {msg.fav && <span className="msg-fav" title="Pinned"><IconStar size={12} /></span>}
        {nameField("msg-name")}
        <span className={"type-pill " + (TYPE_CLASS[msg.type] || "neutral")}>{msg.type}</span>
      </div>
      <div className="msg-preview">{compactJSON(msg.body)}</div>
      <div className="msg-card-actions">
        <button className="btn-send-sm" disabled={!connected}
          onClick={(e) => { e.stopPropagation(); onSend(msg); }}
          title={connected ? "Send now" : "Connect first"}>
          <IconSend size={13} /> Send
        </button>
        <button className="icon-btn xs" title="Load in composer"
          onClick={(e) => { e.stopPropagation(); onLoad(msg); }}>
          <IconCopy size={13} />
        </button>
        <button className="icon-btn xs" title="More"
          onClick={(e) => e.stopPropagation()}><IconDots size={13} /></button>
      </div>
    </div>
  );
}

function keyOf(arr) { return arr.map((m) => m.id + (m.fav ? "*" : "")).join(","); }

function MessageLibrary({ item, messages, connected, onSend, onLoad, onReorder, onRenameMsg, onDuplicateMsg, activeMsgId, collectionName, onRename, width }) {
  const [q, setQ] = useStateLib("");
  const [dragId, setDragId] = useStateLib(null);
  const [compact, setCompact] = useStateLib(() => {
    try { return localStorage.getItem("relay.msgCompact") === "1"; } catch (e) { return false; }
  });
  const toggleCompact = () => setCompact((v) => { try { localStorage.setItem("relay.msgCompact", v ? "0" : "1"); } catch (e) {} return !v; });
  const dragRef = React.useRef(null);
  const setDrag = (id) => { dragRef.current = id; setDragId(id); };
  if (!item || item.kind !== "ws") return null;
  const canDrag = !q;
  const list = (messages || []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const favs = list.filter((m) => m.fav);
  const rest = list.filter((m) => !m.fav);

  // reorder relative to a target card
  const reorder = (targetId, before) => {
    const did = dragRef.current;
    if (did == null || did === targetId) return;
    const src = messages.find((m) => m.id === did);
    const tgt = messages.find((m) => m.id === targetId);
    if (!src || !tgt) return;
    const dragged = { ...src, fav: tgt.fav };
    const arr = messages.filter((m) => m.id !== did);
    const ti = arr.findIndex((m) => m.id === targetId);
    arr.splice(before ? ti : ti + 1, 0, dragged);
    if (keyOf(arr) !== keyOf(messages)) onReorder(arr);
  };
  // drop into a section's end (also re-pins / un-pins)
  const toSection = (favFlag) => {
    const did = dragRef.current;
    if (did == null) return;
    const src = messages.find((m) => m.id === did);
    if (!src) return;
    const dragged = { ...src, fav: favFlag };
    const arr = messages.filter((m) => m.id !== did);
    if (favFlag) { const idx = arr.reduce((a, m, i) => (m.fav ? i + 1 : a), 0); arr.splice(idx, 0, dragged); }
    else arr.push(dragged);
    if (keyOf(arr) !== keyOf(messages)) onReorder(arr);
  };

  const renderSection = (label, favFlag, items) => {
    if (items.length === 0 && !dragId) return null;
    return (
      <div className="lib-group" key={label}
        onDragOver={(e) => { if (dragRef.current != null) { e.preventDefault(); } }}>
        <div className="lib-section">{label}<span className="lib-section-n">{items.length}</span></div>
        <div className={"msg-list" + (compact ? " compact" : "")}>
          {items.map((m) => (
            <MessageCard key={m.id} msg={m} connected={connected} canDrag={canDrag} compact={compact}
              dragging={dragId === m.id} active={m.id === activeMsgId}
              onSend={onSend} onLoad={onLoad} onRename={onRenameMsg} onDuplicate={onDuplicateMsg}
              onDragStart={(e) => { setDrag(m.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                if (dragRef.current == null) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                reorder(m.id, e.clientY < r.top + r.height / 2);
              }} />
          ))}
          {dragId != null && (
            <div className="drop-zone" onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => toSection(favFlag)}>
              {favFlag ? "Pin here" : "Drop here"}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="library" style={width ? { width } : undefined}>
      <div className="pane-head">
        <EditableName value={collectionName || "Messages"} onCommit={onRename}
          editClassName="title-edit"
          renderIdle={({ begin }) => (
            <span className="pane-title editable" title="Double-click to rename"
              onDoubleClick={begin}>
              {collectionName || "Messages"}
              <span className="title-rename" role="button" tabIndex={-1} title="Rename collection"
                onClick={(e) => { e.stopPropagation(); begin(); }}>
                <IconPencil size={13} />
              </span>
            </span>
          )} />
        <span className="pane-sub">{list.length}</span>
        <div className="pane-head-spacer"></div>
        <button className="icon-btn sm" title={compact ? "Comfortable view" : "Compact view"} onClick={toggleCompact}>
          {compact ? <IconCards size={15} /> : <IconList size={15} />}
        </button>
        <button className="btn btn-secondary xs"><IconPlus size={14} /> New</button>
      </div>
      <div className="sidebar-search slim">
        <IconSearch size={14} />
        <input placeholder="Filter messages" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className={"library-scroll" + (dragId != null ? " dragging" : "")}>
        {renderSection("Pinned", true, favs)}
        {renderSection("All messages", false, rest)}
        {list.length === 0 && <div className="empty-sm">No messages match.</div>}
      </div>
    </section>
  );
}

Object.assign(window, { MessageLibrary });
