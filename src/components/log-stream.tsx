// Log panes: unified scroll or split sent/received. Ported from
// design/workspace.jsx (LogStream). Auto-sticks to bottom unless scrolled up.
import { useEffect, useRef } from "react";
import type { Format } from "../formats/serialize";
import type { Frame } from "../transport/transport";
import { LogRow } from "./log-row";
import { IconArrowUp, IconArrowDown } from "./icons";

interface LogStreamProps {
  frames: Frame[];
  dense: boolean;
  split: boolean;
  fmt: Format;
}

function useStickyScroll(len: number) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [len]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { ref, onScroll };
}

export function LogStream({ frames, dense, split, fmt }: LogStreamProps) {
  const unified = useStickyScroll(frames.length);
  const sent = useStickyScroll(frames.length);
  const recv = useStickyScroll(frames.length);

  if (split) {
    const out = frames.filter((f) => f.dir === "out");
    const inc = frames.filter((f) => f.dir !== "out");
    return (
      <div className="log-split">
        <div className="log-col">
          <div className="log-col-head">
            <IconArrowUp size={13} /> Sent <span>{out.length}</span>
          </div>
          <div className="log-scroll" ref={sent.ref} onScroll={sent.onScroll}>
            {out.map((f) => (
              <LogRow key={f.id} f={f} dense={dense} fmt={fmt} />
            ))}
            {out.length === 0 && <div className="empty-sm">No messages sent yet.</div>}
          </div>
        </div>
        <div className="log-col">
          <div className="log-col-head">
            <IconArrowDown size={13} /> Received <span>{inc.length}</span>
          </div>
          <div className="log-scroll alt" ref={recv.ref} onScroll={recv.onScroll}>
            {inc.map((f) => (
              <LogRow key={f.id} f={f} dense={dense} fmt={fmt} />
            ))}
            {inc.length === 0 && <div className="empty-sm">Waiting for server frames…</div>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="log-scroll" ref={unified.ref} onScroll={unified.onScroll}>
      {frames.map((f) => (
        <LogRow key={f.id} f={f} dense={dense} fmt={fmt} />
      ))}
    </div>
  );
}
