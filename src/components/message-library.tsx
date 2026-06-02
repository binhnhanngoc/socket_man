// Saved message library (middle pane) with drag-to-reorder + pin sections.
// Ported from design/library.jsx.
import { useRef, useState } from "react";
import type { Item, SavedMessage } from "../types";
import { EditableName } from "../lib/editable-name";
import { MessageCard } from "./message-card";
import { IconSearch, IconPlus, IconList, IconCards, IconPencil } from "./icons";

interface MessageLibraryProps {
  item: Item;
  messages: SavedMessage[] | undefined;
  connected: boolean;
  onSend: (m: SavedMessage) => void;
  onLoad: (m: SavedMessage) => void;
  onReorder: (next: SavedMessage[]) => void;
  onRenameMsg: (id: string, name: string) => void;
  onDuplicateMsg: (id: string) => void;
  activeMsgId: string | null;
  collectionName: string;
  onRename: (name: string) => void;
  width: number;
}

function keyOf(arr: SavedMessage[]) {
  return arr.map((m) => m.id + (m.fav ? "*" : "")).join(",");
}

export function MessageLibrary({
  item,
  messages,
  connected,
  onSend,
  onLoad,
  onReorder,
  onRenameMsg,
  onDuplicateMsg,
  activeMsgId,
  collectionName,
  onRename,
  width,
}: MessageLibraryProps) {
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem("relay.msgCompact") === "1";
    } catch {
      return false;
    }
  });
  const toggleCompact = () =>
    setCompact((v) => {
      try {
        localStorage.setItem("relay.msgCompact", v ? "0" : "1");
      } catch {
        // ignore
      }
      return !v;
    });
  const dragRef = useRef<string | null>(null);
  const setDrag = (id: string | null) => {
    dragRef.current = id;
    setDragId(id);
  };
  if (!item || item.kind !== "ws") return null;
  const canDrag = !q;
  const list = (messages || []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const favs = list.filter((m) => m.fav);
  const rest = list.filter((m) => !m.fav);

  const reorder = (targetId: string, before: boolean) => {
    const did = dragRef.current;
    if (did == null || did === targetId || !messages) return;
    const src = messages.find((m) => m.id === did);
    const tgt = messages.find((m) => m.id === targetId);
    if (!src || !tgt) return;
    const dragged = { ...src, fav: tgt.fav };
    const arr = messages.filter((m) => m.id !== did);
    const ti = arr.findIndex((m) => m.id === targetId);
    arr.splice(before ? ti : ti + 1, 0, dragged);
    if (keyOf(arr) !== keyOf(messages)) onReorder(arr);
  };
  const toSection = (favFlag: boolean) => {
    const did = dragRef.current;
    if (did == null || !messages) return;
    const src = messages.find((m) => m.id === did);
    if (!src) return;
    const dragged = { ...src, fav: favFlag };
    const arr = messages.filter((m) => m.id !== did);
    if (favFlag) {
      const idx = arr.reduce((a, m, i) => (m.fav ? i + 1 : a), 0);
      arr.splice(idx, 0, dragged);
    } else arr.push(dragged);
    if (keyOf(arr) !== keyOf(messages)) onReorder(arr);
  };

  const renderSection = (label: string, favFlag: boolean, items: SavedMessage[]) => {
    if (items.length === 0 && !dragId) return null;
    return (
      <div
        className="lib-group"
        key={label}
        onDragOver={(e) => {
          if (dragRef.current != null) e.preventDefault();
        }}
      >
        <div className="lib-section">
          {label}
          <span className="lib-section-n">{items.length}</span>
        </div>
        <div className={"msg-list" + (compact ? " compact" : "")}>
          {items.map((m) => (
            <MessageCard
              key={m.id}
              msg={m}
              connected={connected}
              canDrag={canDrag}
              compact={compact}
              dragging={dragId === m.id}
              active={m.id === activeMsgId}
              onSend={onSend}
              onLoad={onLoad}
              onRename={onRenameMsg}
              onDuplicate={onDuplicateMsg}
              onDragStart={(e) => {
                setDrag(m.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                if (dragRef.current == null) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                reorder(m.id, e.clientY < r.top + r.height / 2);
              }}
            />
          ))}
          {dragId != null && (
            <div className="drop-zone" onDragOver={(e) => e.preventDefault()} onDragEnter={() => toSection(favFlag)}>
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
        <EditableName
          value={collectionName || "Messages"}
          onCommit={onRename}
          editClassName="title-edit"
          renderIdle={({ begin }) => (
            <span className="pane-title editable" title="Double-click to rename" onDoubleClick={begin}>
              {collectionName || "Messages"}
              <span
                className="title-rename"
                role="button"
                tabIndex={-1}
                title="Rename collection"
                onClick={(e) => {
                  e.stopPropagation();
                  begin(e);
                }}
              >
                <IconPencil size={13} />
              </span>
            </span>
          )}
        />
        <span className="pane-sub">{list.length}</span>
        <div className="pane-head-spacer"></div>
        <button className="icon-btn sm" title={compact ? "Comfortable view" : "Compact view"} onClick={toggleCompact}>
          {compact ? <IconCards size={15} /> : <IconList size={15} />}
        </button>
        <button className="btn btn-secondary xs">
          <IconPlus size={14} /> New
        </button>
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
