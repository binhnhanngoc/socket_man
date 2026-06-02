// environments.jsx — environment switcher popover + editor modal. Exports to window.
const { useState: useStateEnv, useEffect: useEffectEnv, useRef: useRefEnv } = React;

const ENV_SWATCHES = ["leaf", "solar", "pond", "rust", "flare", "clay"];

// ---- popover anchored under the top-nav env button ------------------------
function EnvMenu({ environments, activeEnvId, onSwitch, onEdit, onAdd, onClose }) {
  const ref = useRefEnv(null);
  useEffectEnv(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, []);
  return (
    <div className="env-menu" ref={ref}>
      <div className="env-menu-head">Environment</div>
      <div className="env-menu-list">
        <div className={"env-row" + (activeEnvId == null ? " active" : "")}>
          <button className="env-pick" onClick={() => { onSwitch(null); onClose(); }}>
            <span className="env-dot" style={{ background: "var(--stone)" }}></span>
            <span className="env-pick-name">No environment</span>
            {activeEnvId == null && <IconCheck size={15} />}
          </button>
        </div>
        {environments.map((e) => (
          <div key={e.id} className={"env-row" + (e.id === activeEnvId ? " active" : "")}>
            <button className="env-pick" onClick={() => { onSwitch(e.id); onClose(); }}>
              <span className="env-dot" style={{ background: ENV_COLOR[e.color] || "var(--accent)" }}></span>
              <span className="env-pick-name">{e.name}</span>
              <span className="env-pick-count">{e.vars.length}</span>
              {e.id === activeEnvId && <IconCheck size={15} />}
            </button>
            <button className="env-edit-btn" title="Edit environment"
              onClick={() => onEdit(e.id)}><IconPencil size={13} /></button>
          </div>
        ))}
      </div>
      <button className="env-add" onClick={onAdd}><IconPlus size={14} /> New environment</button>
    </div>
  );
}

// ---- full editor modal ----------------------------------------------------
function EnvEditor({ env, isNew, onSave, onDelete, onClose }) {
  const [name, setName] = useStateEnv(env.name);
  const [color, setColor] = useStateEnv(env.color);
  const [vars, setVars] = useStateEnv(env.vars.length ? env.vars : [{ id: "v" + Date.now(), key: "", value: "", secret: false }]);
  const firstRef = useRefEnv(null);
  useEffectEnv(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    if (isNew && firstRef.current) firstRef.current.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const setVar = (id, patch) => setVars((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const addVar = () => setVars((vs) => [...vs, { id: "v" + Date.now() + Math.random().toString(36).slice(2, 5), key: "", value: "", secret: false }]);
  const removeVar = (id) => setVars((vs) => vs.filter((v) => v.id !== id));
  const save = () => {
    const cleaned = vars.filter((v) => v.key.trim() || v.value.trim());
    onSave({ ...env, name: name.trim() || env.name, color, vars: cleaned });
    onClose();
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal env-modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-head-l">
            <span className="env-modal-dot" style={{ background: ENV_COLOR[color] || "var(--accent)" }}></span>
            <span className="modal-title">{isNew ? "New environment" : "Edit environment"}</span>
          </div>
          <button className="icon-btn sm" title="Close" onClick={onClose}><IconX size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="env-name-row">
            <div className="field-inline">
              <label>Name</label>
              <input ref={firstRef} className="input" value={name} spellCheck="false"
                placeholder="e.g. Staging" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field-inline">
              <label>Color</label>
              <div className="env-swatches">
                {ENV_SWATCHES.map((c) => (
                  <button key={c} className={"env-swatch" + (c === color ? " on" : "")}
                    style={{ background: ENV_COLOR[c] }} title={c} onClick={() => setColor(c)}>
                    {c === color && <IconCheck size={12} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lib-section env-vars-head">
            Variables
            <span className="env-vars-hint">reference anywhere as <span className="mono">{"{{key}}"}</span></span>
          </div>
          <div className="env-var-grid">
            <div className="env-var-grid-head">
              <span>Key</span><span>Value</span><span></span><span></span>
            </div>
            {vars.map((v) => (
              <div className="env-var-row" key={v.id}>
                <input className="kv-k" value={v.key} placeholder="key" spellCheck="false"
                  onChange={(e) => setVar(v.id, { key: e.target.value })} />
                <input className={"kv-v mono" + (v.secret ? " secret" : "")} value={v.value} placeholder="value" spellCheck="false"
                  onChange={(e) => setVar(v.id, { value: e.target.value })} />
                <button className={"env-secret" + (v.secret ? " on" : "")}
                  title={v.secret ? "Marked secret — value is masked elsewhere" : "Mark as secret"}
                  onClick={() => setVar(v.id, { secret: !v.secret })}><IconLock size={14} /></button>
                <button className="env-var-del" title="Remove variable"
                  onClick={() => removeVar(v.id)}><IconX size={14} /></button>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary xs add-row" onClick={addVar}><IconPlus size={14} /> Add variable</button>
        </div>

        <div className="modal-foot">
          {!isNew && (
            <button className="btn-ghost-danger" onClick={() => onDelete(env.id)}>
              <IconTrash size={14} /> Delete
            </button>
          )}
          <div className="pane-head-spacer"></div>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-rust" onClick={save}>{isNew ? "Create environment" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { EnvMenu, EnvEditor });
