// Environment editor modal. Ported from design/environments.jsx.
import { useEffect, useRef, useState } from "react";
import type { Environment, EnvVar } from "../types";
import { ENV_COLOR } from "../data/starter-data";
import { transport } from "../transport";
import { IconX, IconCheck, IconLock, IconPlus, IconTrash } from "./icons";

const ENV_SWATCHES = ["leaf", "solar", "pond", "rust", "flare", "clay"];

interface EnvEditorProps {
  env: Environment;
  isNew: boolean;
  onSave: (env: Environment) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function EnvEditor({ env, isNew, onSave, onDelete, onClose }: EnvEditorProps) {
  const [name, setName] = useState(env.name);
  const [color, setColor] = useState(env.color);
  const [vars, setVars] = useState<EnvVar[]>(
    env.vars.length ? env.vars : [{ id: "v" + Date.now(), key: "", value: "", secret: false }]
  );
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    if (isNew && firstRef.current) firstRef.current.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [isNew, onClose]);

  const setVar = (id: string, patch: Partial<EnvVar>) =>
    setVars((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const addVar = () =>
    setVars((vs) => [...vs, { id: "v" + Date.now() + Math.random().toString(36).slice(2, 5), key: "", value: "", secret: false }]);
  const removeVar = (id: string) => setVars((vs) => vs.filter((v) => v.id !== id));

  // Secret values go to the OS keychain (write-only); only a {key, secret} ref is
  // persisted on disk. Reconcile on save: delete keychain entries for vars no longer
  // secret/present, write the ones that were (re)typed, then strip plaintext.
  const save = async () => {
    const cleaned = vars.filter((v) => v.key.trim() || v.value.trim());
    const origSecretKeys = env.vars.filter((v) => v.secret && v.key.trim()).map((v) => v.key);
    const newSecretKeys = new Set(cleaned.filter((v) => v.secret && v.key.trim()).map((v) => v.key));

    for (const k of origSecretKeys) {
      if (!newSecretKeys.has(k)) {
        try {
          await transport.secretDelete(env.id, k);
        } catch {
          // best-effort orphan cleanup
        }
      }
    }
    for (const v of cleaned) {
      // Empty value on an existing secret = keep the keychain value (write-only field).
      if (v.secret && v.key.trim() && v.value.trim()) {
        try {
          await transport.secretSet(env.id, v.key.trim(), v.value);
        } catch {
          // keychain unavailable → the var still saves as a ref; resolve will error clearly
        }
      }
    }
    // Never persist a secret VALUE to disk — store the ref only.
    const persistedVars = cleaned.map((v) => (v.secret ? { ...v, value: "" } : v));
    onSave({ ...env, name: name.trim() || env.name, color, vars: persistedVars });
    onClose();
  };

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
            <span className="env-modal-dot" style={{ background: ENV_COLOR[color] || "var(--accent)" }}></span>
            <span className="modal-title">{isNew ? "New environment" : "Edit environment"}</span>
          </div>
          <button className="icon-btn sm" title="Close" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="env-name-row">
            <div className="field-inline">
              <label>Name</label>
              <input
                ref={firstRef}
                className="input"
                value={name}
                spellCheck={false}
                placeholder="e.g. Staging"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field-inline">
              <label>Color</label>
              <div className="env-swatches">
                {ENV_SWATCHES.map((c) => (
                  <button
                    key={c}
                    className={"env-swatch" + (c === color ? " on" : "")}
                    style={{ background: ENV_COLOR[c] }}
                    title={c}
                    onClick={() => setColor(c)}
                  >
                    {c === color && <IconCheck size={12} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lib-section env-vars-head">
            Variables
            <span className="env-vars-hint">
              reference anywhere as <span className="mono">{"{{key}}"}</span>
            </span>
          </div>
          <div className="env-var-grid">
            <div className="env-var-grid-head">
              <span>Key</span>
              <span>Value</span>
              <span></span>
              <span></span>
            </div>
            {vars.map((v) => (
              <div className="env-var-row" key={v.id}>
                <input
                  className="kv-k"
                  value={v.key}
                  placeholder="key"
                  spellCheck={false}
                  onChange={(e) => setVar(v.id, { key: e.target.value })}
                />
                <input
                  className={"kv-v mono" + (v.secret ? " secret" : "")}
                  type={v.secret ? "password" : "text"}
                  value={v.value}
                  placeholder={v.secret ? "●●●● stored in keychain" : "value"}
                  spellCheck={false}
                  onChange={(e) => setVar(v.id, { value: e.target.value })}
                />
                <button
                  className={"env-secret" + (v.secret ? " on" : "")}
                  title={v.secret ? "Marked secret — value is masked elsewhere" : "Mark as secret"}
                  onClick={() => setVar(v.id, { secret: !v.secret })}
                >
                  <IconLock size={14} />
                </button>
                <button className="env-var-del" title="Remove variable" onClick={() => removeVar(v.id)}>
                  <IconX size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary xs add-row" onClick={addVar}>
            <IconPlus size={14} /> Add variable
          </button>
        </div>

        <div className="modal-foot">
          {!isNew && (
            <button className="btn-ghost-danger" onClick={() => onDelete(env.id)}>
              <IconTrash size={14} /> Delete
            </button>
          )}
          <div className="pane-head-spacer"></div>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-rust" onClick={save}>
            {isNew ? "Create environment" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
