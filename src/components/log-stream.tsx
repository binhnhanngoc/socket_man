// Log panes: unified scroll or split sent/received. Each scroll container is
// virtualized (@tanstack/react-virtual, dynamic row measurement) so a 10k+ frame
// log stays smooth with a bounded DOM node count. Sticky-to-bottom is preserved:
// it follows new frames via the virtualizer unless the user has scrolled up.
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

// One virtualized, sticky-to-bottom scroll column.
function VirtualLog({ frames, dense, fmt, alt, emptyMsg }: {
  frames: Frame[];
  dense: boolean;
  fmt: Format;
  alt?: boolean;
  emptyMsg?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => parentRef.current,
    // Collapsed-row estimate; real heights (incl. expanded bodies) are measured
    // dynamically via measureElement (ResizeObserver) so dense/variable rows align.
    estimateSize: () => (dense ? 30 : 54),
    overscan: 14,
    getItemKey: (i) => frames[i].id,
  });

  // Auto-follow new frames while pinned to the bottom. Re-implemented against the
  // virtualizer's total size (the old direct scrollHeight math no longer applies).
  useEffect(() => {
    if (stick.current && frames.length > 0) {
      virtualizer.scrollToIndex(frames.length - 1, { align: "end" });
    }
  }, [frames.length, virtualizer]);

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const items = virtualizer.getVirtualItems();
  return (
    <div className={"log-scroll" + (alt ? " alt" : "")} ref={parentRef} onScroll={onScroll}>
      {frames.length === 0 && emptyMsg ? (
        <div className="empty-sm">{emptyMsg}</div>
      ) : (
        <div className="log-virtual" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((vi) => (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="log-virtual-row"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <LogRow f={frames[vi.index]} dense={dense} fmt={fmt} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LogStream({ frames, dense, split, fmt }: LogStreamProps) {
  if (split) {
    const out = frames.filter((f) => f.dir === "out");
    const inc = frames.filter((f) => f.dir !== "out");
    return (
      <div className="log-split">
        <div className="log-col">
          <div className="log-col-head">
            <IconArrowUp size={13} /> Sent <span>{out.length}</span>
          </div>
          <VirtualLog frames={out} dense={dense} fmt={fmt} emptyMsg="No messages sent yet." />
        </div>
        <div className="log-col">
          <div className="log-col-head">
            <IconArrowDown size={13} /> Received <span>{inc.length}</span>
          </div>
          <VirtualLog frames={inc} dense={dense} fmt={fmt} alt emptyMsg="Waiting for server frames…" />
        </div>
      </div>
    );
  }
  return <VirtualLog frames={frames} dense={dense} fmt={fmt} />;
}
