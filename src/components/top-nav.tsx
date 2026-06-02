// Top navigation bar: brand, environment switcher, theme toggle, settings.
// Ported from design/sidebar.jsx. The Settings gear opens the Tweaks panel
// (there is no host edit-mode protocol in Tauri — F22).
import { useState } from "react";
import type { Environment } from "../types";
import { ENV_COLOR } from "../data/starter-data";
import { EnvMenu } from "./env-menu";
import { IconChevron, IconBolt, IconStar, IconSettings, IconClock } from "./icons";

interface TopNavProps {
  dark: boolean;
  onToggleDark: () => void;
  onOpenTweaks: () => void;
  onOpenHistory: () => void;
  environments: Environment[];
  activeEnv: Environment | null;
  onSwitchEnv: (id: string | null) => void;
  onEditEnv: (id: string) => void;
  onAddEnv: () => void;
}

export function TopNav({ dark, onToggleDark, onOpenTweaks, onOpenHistory, environments, activeEnv, onSwitchEnv, onEditEnv, onAddEnv }: TopNavProps) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="topnav">
      <div className="topnav-brand">
        <img src="/assets/logo-mark.svg" width="26" height="26" alt="" />
        <div className="brand-text">
          <span className="brand-name">SocketMan</span>
          <span className="brand-product">Workbench</span>
        </div>
      </div>
      <div className="topnav-env-wrap">
        <button className={"topnav-env" + (menu ? " open" : "")} onClick={() => setMenu((m) => !m)} title="Switch environment">
          <span
            className="env-dot"
            style={{ background: activeEnv ? ENV_COLOR[activeEnv.color] || "var(--accent)" : "var(--stone)" }}
          ></span>
          {activeEnv ? activeEnv.name : "No environment"}
          <IconChevron size={14} open={menu} />
        </button>
        {menu && (
          <EnvMenu
            environments={environments}
            activeEnvId={activeEnv ? activeEnv.id : null}
            onSwitch={onSwitchEnv}
            onEdit={(id) => {
              setMenu(false);
              onEditEnv(id);
            }}
            onAdd={() => {
              setMenu(false);
              onAddEnv();
            }}
            onClose={() => setMenu(false)}
          />
        )}
      </div>
      <div className="topnav-spacer"></div>
      <button className="icon-btn" title="History" onClick={onOpenHistory}>
        <IconClock size={16} />
      </button>
      <button className="icon-btn" title="Toggle theme" onClick={onToggleDark}>
        {dark ? <IconBolt size={16} /> : <IconStar size={16} />}
      </button>
      <button className="icon-btn" title="Settings" onClick={onOpenTweaks}>
        <IconSettings size={16} />
      </button>
      <div className="topnav-user">JR</div>
    </header>
  );
}
