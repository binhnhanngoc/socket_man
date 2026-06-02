// Message composer: format-aware editor with live validity badge + send.
// Ported from design/workspace.jsx.
import { useMemo } from "react";
import { serialize, parseFmt, type Format } from "../formats/serialize";
import { IconCheck, IconX, IconBolt, IconSend } from "./icons";

interface ComposerProps {
  draft: string;
  setDraft: (v: string) => void;
  connected: boolean;
  onSend: (body: unknown) => void;
  fmt: Format;
  onFmt: (f: Format) => void;
}

const FORMATS: [Format, string][] = [
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["xml", "XML"],
  ["text", "Text"],
];

export function Composer({ draft, setDraft, connected, onSend, fmt, onFmt }: ComposerProps) {
  const valid = useMemo(() => {
    if (!draft.trim()) return { ok: false, err: "Empty" };
    try {
      parseFmt(draft, fmt);
      return { ok: true, err: "" };
    } catch (e) {
      return { ok: false, err: (e as Error).message.replace(/^JSON.parse:?\s*/i, "") };
    }
  }, [draft, fmt]);

  const format = () => {
    try {
      setDraft(serialize(parseFmt(draft, fmt), fmt));
    } catch {
      // leave draft as-is when it doesn't parse
    }
  };
  const send = () => {
    if (valid.ok && connected) onSend(parseFmt(draft, fmt));
  };
  const bytes = new Blob([draft]).size;

  return (
    <div className="composer">
      <div className="composer-head">
        <span className="pane-title sm">Compose message</span>
        <div className="seg fmt-seg sm">
          {FORMATS.map(([k, l]) => (
            <button key={k} className={"seg-btn" + (fmt === k ? " on" : "")} onClick={() => onFmt(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="pane-head-spacer"></div>
        <span className={"valid-badge " + (valid.ok ? "ok" : "bad")}>
          {valid.ok ? (
            <>
              <IconCheck size={12} /> Valid {fmt.toUpperCase()}
            </>
          ) : (
            <>
              <IconX size={12} /> {valid.err}
            </>
          )}
        </span>
        <button className="icon-btn xs" title="Format / tidy" onClick={format}>
          <IconBolt size={14} />
        </button>
      </div>
      <textarea
        className="composer-input"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
        }}
      />
      <div className="composer-foot">
        <span className="composer-hint">
          {bytes} B · {fmt.toUpperCase()} · ⌘↵ to send
        </span>
        <div className="pane-head-spacer"></div>
        <button className="btn btn-rust" disabled={!valid.ok || !connected} onClick={send}>
          <IconSend size={15} /> Send message
        </button>
      </div>
    </div>
  );
}
