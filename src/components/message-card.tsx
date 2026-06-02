// One saved-message card (compact or full). Ported from design/library.jsx.
import type { SavedMessage } from "../types";
import { compactJSON } from "../lib/util";
import { EditableName } from "../lib/editable-name";
import { IconGrip, IconStar, IconSend, IconCopy, IconDots, IconPencil } from "./icons";

export const TYPE_CLASS: Record<string, string> = {
  subscribe: "leaf",
  config: "pond",
  control: "neutral",
  event: "rust",
};

interface MessageCardProps {
  msg: SavedMessage;
  connected: boolean;
  onSend: (m: SavedMessage) => void;
  onLoad: (m: SavedMessage) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  active: boolean;
  canDrag: boolean;
  dragging: boolean;
  compact: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

export function MessageCard({
  msg,
  connected,
  onSend,
  onLoad,
  onRename,
  onDuplicate,
  active,
  canDrag,
  dragging,
  compact,
  onDragStart,
  onDragOver,
  onDragEnd,
}: MessageCardProps) {
  const dragProps = {
    draggable: canDrag,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop: (e: React.DragEvent) => e.preventDefault(),
  };
  const nameField = (cls: string) => (
    <EditableName
      value={msg.name}
      onCommit={(name) => onRename(msg.id, name)}
      renderIdle={({ begin }) => (
        <>
          <span
            className={cls}
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              begin(e);
            }}
          >
            {msg.name}
          </span>
          <span
            className="msg-rename"
            role="button"
            tabIndex={-1}
            title="Rename message"
            onClick={(e) => {
              e.stopPropagation();
              begin(e);
            }}
          >
            <IconPencil size={11} />
          </span>
          <span
            className="msg-rename"
            role="button"
            tabIndex={-1}
            title="Duplicate message"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(msg.id);
            }}
          >
            <IconCopy size={11} />
          </span>
        </>
      )}
    />
  );

  if (compact) {
    return (
      <div
        className={"msg-card compact" + (active ? " active" : "") + (dragging ? " dragging" : "")}
        {...dragProps}
        onClick={(e) => {
          if (e.detail > 1) return;
          onLoad(msg);
        }}
      >
        {canDrag && (
          <span className="msg-grip" title="Drag to reorder">
            <IconGrip size={13} />
          </span>
        )}
        <span className={"type-dot " + (TYPE_CLASS[msg.type] || "neutral")} title={msg.type}></span>
        {nameField("msg-name")}
        {msg.fav && (
          <span className="msg-fav" title="Pinned">
            <IconStar size={11} />
          </span>
        )}
        <button
          className="msg-send-ico"
          disabled={!connected}
          onClick={(e) => {
            e.stopPropagation();
            onSend(msg);
          }}
          title={connected ? "Send now" : "Connect first"}
        >
          <IconSend size={13} />
        </button>
      </div>
    );
  }
  return (
    <div
      className={"msg-card" + (active ? " active" : "") + (dragging ? " dragging" : "")}
      {...dragProps}
      onClick={(e) => {
        if (e.detail > 1) return;
        onLoad(msg);
      }}
    >
      <div className="msg-card-top">
        {canDrag && (
          <span className="msg-grip" title="Drag to reorder">
            <IconGrip size={14} />
          </span>
        )}
        {msg.fav && (
          <span className="msg-fav" title="Pinned">
            <IconStar size={12} />
          </span>
        )}
        {nameField("msg-name")}
        <span className={"type-pill " + (TYPE_CLASS[msg.type] || "neutral")}>{msg.type}</span>
      </div>
      <div className="msg-preview">{compactJSON(msg.body)}</div>
      <div className="msg-card-actions">
        <button
          className="btn-send-sm"
          disabled={!connected}
          onClick={(e) => {
            e.stopPropagation();
            onSend(msg);
          }}
          title={connected ? "Send now" : "Connect first"}
        >
          <IconSend size={13} /> Send
        </button>
        <button
          className="icon-btn xs"
          title="Load in composer"
          onClick={(e) => {
            e.stopPropagation();
            onLoad(msg);
          }}
        >
          <IconCopy size={13} />
        </button>
        <button className="icon-btn xs" title="More" onClick={(e) => e.stopPropagation()}>
          <IconDots size={13} />
        </button>
      </div>
    </div>
  );
}
