// sidebar.jsx — top nav + collections tree (left pane). Exports to window.
const { useState } = React;

function TopNav({ accent, dark, onToggleDark, environments, activeEnv, onSwitchEnv, onEditEnv, onAddEnv }) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="topnav">
      <div className="topnav-brand">
        <img src="assets/logo-mark.svg" width="26" height="26" alt="" />
        <div className="brand-text">
          <span className="brand-name">Atomiton</span>
          <span className="brand-product">Relay</span>
        </div>
      </div>
      <div className="topnav-env-wrap">
        <button className={"topnav-env" + (menu ? " open" : "")} onClick={() => setMenu((m) => !m)} title="Switch environment">
          <span className="env-dot" style={{ background: activeEnv ? (ENV_COLOR[activeEnv.color] || "var(--accent)") : "var(--stone)" }}></span>
          {activeEnv ? activeEnv.name : "No environment"}
          <IconChevron size={14} open={menu} />
        </button>
        {menu && (
          <EnvMenu environments={environments} activeEnvId={activeEnv ? activeEnv.id : null}
            onSwitch={onSwitchEnv}
            onEdit={(id) => { setMenu(false); onEditEnv(id); }}
            onAdd={() => { setMenu(false); onAddEnv(); }}
            onClose={() => setMenu(false)} />
        )}
      </div>
      <div className="topnav-spacer"></div>
      <button className="icon-btn" title="Toggle theme" onClick={onToggleDark}>
        {dark ? <IconBolt size={16} /> : <IconStar size={16} />}
      </button>
      <button className="icon-btn" title="Settings"><IconSettings size={16} /></button>
      <div className="topnav-user">JR</div>
    </header>
  );
}

function CollectionsSidebar({ collections, activeId, onSelect, statuses, onRename, onRenameItem, onDuplicateColl, onDuplicateItem, width, collapsed, onToggleCollapse }) {
  const [open, setOpen] = useState(() => new Set(collections.map((c) => c.id)));
  const [q, setQ] = useState("");
  const toggle = (id) => {
    const n = new Set(open);
    n.has(id) ? n.delete(id) : n.add(id);
    setOpen(n);
  };
  const matches = (it) => !q || it.name.toLowerCase().includes(q.toLowerCase()) || it.url.toLowerCase().includes(q.toLowerCase());

  if (collapsed) {
    return (
      <nav className="sidebar collapsed">
        <button className="icon-btn rail-toggle" title="Expand collections" onClick={onToggleCollapse}>
          <IconSidebar size={17} />
        </button>
        <div className="rail-sep"></div>
        <button className="rail-folder" title="Expand collections" onClick={onToggleCollapse}>
          <IconFolder size={16} />
          <span className="rail-count">{collections.length}</span>
        </button>
        <span className="rail-label">Collections</span>
      </nav>
    );
  }

  return (
    <nav className="sidebar" style={width ? { width } : undefined}>
      <div className="sidebar-head">
        <span className="pane-title">Collections</span>
        <button className="icon-btn sm" title="New collection"><IconPlus size={15} /></button>
        <button className="icon-btn sm" title="Collapse panel" onClick={onToggleCollapse}><IconSidebar size={15} /></button>
      </div>
      <div className="sidebar-search">
        <IconSearch size={14} />
        <input placeholder="Search requests" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="sidebar-scroll">
        {collections.map((c) => {
          const items = c.items.filter(matches);
          if (q && items.length === 0) return null;
          const isOpen = open.has(c.id) || !!q;
          return (
            <div className="coll" key={c.id}>
              <button className="coll-head" onClick={(e) => { if (e.detail > 1) return; toggle(c.id); }}>
                <IconChevron size={14} open={isOpen} />
                <IconFolder size={15} />
                <EditableName value={c.name} onCommit={(name) => onRename(c.id, name)}
                  renderIdle={({ begin }) => (
                    <>
                      <span className="coll-name" title="Double-click to rename"
                        onDoubleClick={begin}>{c.name}</span>
                      <span className="coll-rename" role="button" tabIndex={-1} title="Rename collection"
                        onClick={(e) => { e.stopPropagation(); begin(); }}>
                        <IconPencil size={13} />
                      </span>
                      <span className="coll-rename" role="button" tabIndex={-1} title="Duplicate collection"
                        onClick={(e) => { e.stopPropagation(); onDuplicateColl(c.id); }}>
                        <IconCopy size={13} />
                      </span>
                    </>
                  )} />
                <span className="coll-count">{c.items.length}</span>
              </button>
              {isOpen && (
                <div className="coll-items">
                  {items.map((it) => {
                    const st = statuses[it.id];
                    const active = it.id === activeId;
                    return (
                      <button key={it.id}
                        className={"item" + (active ? " active" : "")}
                        onClick={(e) => { if (e.detail > 1) return; onSelect(it.id); }}>
                        <span className={"item-proto " + it.kind}>
                          {it.kind === "ws"
                            ? <IconRadio size={15} />
                            : <span className={"method m-" + it.method}>{it.method}</span>}
                        </span>
                        <EditableName value={it.name} onCommit={(name) => onRenameItem(it.id, name)}
                          renderIdle={({ begin }) => (
                            <>
                              <span className="item-name" title="Double-click to rename"
                                onDoubleClick={begin}>{it.name}</span>
                              <span className="item-rename" role="button" tabIndex={-1} title="Rename"
                                onClick={(e) => { e.stopPropagation(); begin(); }}>
                                <IconPencil size={12} />
                              </span>
                              <span className="item-rename" role="button" tabIndex={-1} title="Duplicate"
                                onClick={(e) => { e.stopPropagation(); onDuplicateItem(it.id); }}>
                                <IconCopy size={12} />
                              </span>
                            </>
                          )} />
                        {it.kind === "ws" && st === "connected" &&
                          <span className="conn-dot live" title="Connected"></span>}
                        {it.kind === "ws" && st === "connecting" &&
                          <span className="conn-dot pending" title="Connecting"></span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sidebar-foot">
        <IconClock size={13} />
        <span>History</span>
      </div>
    </nav>
  );
}

Object.assign(window, { TopNav, CollectionsSidebar });
