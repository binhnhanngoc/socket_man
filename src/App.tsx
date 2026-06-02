// App — layout + composition only. The cross-coupled item/connection/message
// state lives in use-workspace-store (F15); independent prefs live in thin hooks
// (use-tweaks / use-environments / use-panels). The 1200ms clock is UI-only and
// stays here (drives the connection elapsed timer).
import { useEffect, useState } from "react";
import { useTweaks } from "./hooks/use-tweaks";
import { useEnvironments } from "./hooks/use-environments";
import { usePanels } from "./hooks/use-panels";
import { useWorkspaceStore } from "./hooks/use-workspace-store";
import { TopNav } from "./components/top-nav";
import { CollectionsSidebar } from "./components/collections-sidebar";
import { MessageLibrary } from "./components/message-library";
import { WsWorkspace } from "./components/ws-workspace";
import { HttpWorkspace } from "./components/http-workspace";
import { EnvEditor } from "./components/env-editor";
import { Resizer } from "./components/resizer";
import { TweaksPanel } from "./components/tweaks-panel";
import { TweakSection, TweakRadio, TweakToggle, TweakColor } from "./components/tweak-controls";

const ACCENTS = ["#C44D1E", "#3F6B72", "#5D7A3C", "#8B5A3C"];

export default function App() {
  const [t, setTweak] = useTweaks();
  const env = useEnvironments();
  const panels = usePanels();
  const store = useWorkspaceStore(env.activeEnv);
  const [now, setNow] = useState(() => Date.now());
  const [tweaksOpen, setTweaksOpen] = useState(false);

  // UI-only clock for the elapsed-connection timer.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1200);
    return () => clearInterval(iv);
  }, []);

  const dense = t.density === "compact";
  const item = store.activeItemWithUrl;

  return (
    <div className={"app" + (t.dark ? " dark" : "")} data-density={t.density} style={{ "--accent": t.accent } as React.CSSProperties}>
      <TopNav
        dark={t.dark}
        onToggleDark={() => setTweak("dark", !t.dark)}
        onOpenTweaks={() => setTweaksOpen(true)}
        environments={env.environments}
        activeEnv={env.activeEnv}
        onSwitchEnv={env.switchEnv}
        onEditEnv={(id) => env.setEditEnv({ id, isNew: false })}
        onAddEnv={env.addEnv}
      />
      <div className="app-body">
        <CollectionsSidebar
          collections={store.collections}
          activeId={store.activeId}
          width={panels.sidebarW}
          collapsed={panels.sidebarCollapsed}
          onToggleCollapse={panels.toggleSidebar}
          onSelect={(id) => {
            store.setActiveId(id);
            store.setActiveMsgId(null);
          }}
          statuses={store.statuses}
          onRename={store.renameColl}
          onRenameItem={store.renameItem}
          onDuplicateColl={store.duplicateCollection}
          onDuplicateItem={store.duplicateItem}
        />
        {!panels.sidebarCollapsed && (
          <Resizer onResize={panels.resizeSidebar} onReset={panels.resetSidebar} label="Resize sidebar" />
        )}

        {item && item.kind === "ws" ? (
          <>
            <MessageLibrary
              item={item}
              messages={store.msgs[store.activeId]}
              width={panels.libraryW}
              connected={!!store.activeConn && store.activeConn.status === "connected"}
              collectionName={store.msgCollNames[store.activeId] || "Messages"}
              onRename={(name) => store.renameMsgColl(store.activeId, name)}
              onSend={(m) => {
                store.setActiveMsgId(m.id);
                store.sendSaved(m);
              }}
              onLoad={(m) => {
                store.setActiveMsgId(m.id);
                store.loadSaved(m);
              }}
              onReorder={store.reorderMsgs}
              onRenameMsg={store.renameMsg}
              onDuplicateMsg={store.duplicateMsg}
              activeMsgId={store.activeMsgId}
            />
            <Resizer onResize={panels.resizeLibrary} onReset={panels.resetLibrary} label="Resize messages" />
            <WsWorkspace
              item={item}
              conn={store.activeConn!}
              paused={store.paused}
              now={now}
              onConnect={() => store.connect(store.activeId)}
              onDisconnect={() => store.disconnect(store.activeId)}
              onUrl={(v) => store.setUrl(store.activeId, v)}
              onSend={(b) => store.sendBody(store.activeId, b)}
              onClear={() => store.clearFrames(store.activeId)}
              onTogglePause={() => store.setPaused(!store.paused)}
              draft={store.draft}
              setDraft={store.setDraft}
              fmt={store.fmt}
              onFmt={store.changeFmt}
              split={t.logLayout === "split"}
              dense={dense}
              env={env.activeEnv}
              meta={store.activeMeta!}
              onMeta={(patch) => store.updateMeta(store.activeId, patch)}
            />
          </>
        ) : (
          item && <HttpWorkspace item={item} />
        )}
      </div>

      {env.editingEnv && env.editEnv && (
        <EnvEditor
          env={env.editingEnv}
          isNew={env.editEnv.isNew}
          onSave={env.saveEnv}
          onDelete={env.deleteEnv}
          onClose={() => env.cancelNewEnv(env.editEnv!.id, env.editEnv!.isNew)}
        />
      )}

      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)}>
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "comfortable"]} onChange={(v) => setTweak("density", v)} />
        <TweakRadio label="Log layout" value={t.logLayout} options={["unified", "split"]} onChange={(v) => setTweak("logLayout", v)} />
        <TweakSection label="Theme" />
        <TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak("dark", v)} />
        <TweakColor label="Accent" value={t.accent} options={ACCENTS} onChange={(v) => setTweak("accent", v)} />
      </TweaksPanel>
    </div>
  );
}
