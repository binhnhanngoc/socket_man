// Environment switcher popover, anchored under the top-nav env button.
// Ported from design/environments.jsx.
import { useEffect, useRef } from "react";
import type { Environment } from "../types";
import { ENV_COLOR } from "../data/starter-data";
import { IconCheck, IconPencil, IconPlus } from "./icons";

interface EnvMenuProps {
  environments: Environment[];
  activeEnvId: string | null;
  onSwitch: (id: string | null) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}

export function EnvMenu({ environments, activeEnvId, onSwitch, onEdit, onAdd, onClose }: EnvMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="env-menu" ref={ref}>
      <div className="env-menu-head">Environment</div>
      <div className="env-menu-list">
        <div className={"env-row" + (activeEnvId == null ? " active" : "")}>
          <button
            className="env-pick"
            onClick={() => {
              onSwitch(null);
              onClose();
            }}
          >
            <span className="env-dot" style={{ background: "var(--stone)" }}></span>
            <span className="env-pick-name">No environment</span>
            {activeEnvId == null && <IconCheck size={15} />}
          </button>
        </div>
        {environments.map((e) => (
          <div key={e.id} className={"env-row" + (e.id === activeEnvId ? " active" : "")}>
            <button
              className="env-pick"
              onClick={() => {
                onSwitch(e.id);
                onClose();
              }}
            >
              <span className="env-dot" style={{ background: ENV_COLOR[e.color] || "var(--accent)" }}></span>
              <span className="env-pick-name">{e.name}</span>
              <span className="env-pick-count">{e.vars.length}</span>
              {e.id === activeEnvId && <IconCheck size={15} />}
            </button>
            <button className="env-edit-btn" title="Edit environment" onClick={() => onEdit(e.id)}>
              <IconPencil size={13} />
            </button>
          </div>
        ))}
      </div>
      <button className="env-add" onClick={onAdd}>
        <IconPlus size={14} /> New environment
      </button>
    </div>
  );
}
