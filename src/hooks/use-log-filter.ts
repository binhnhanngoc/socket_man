// Frame-log filter state (direction set + free text). Lifted to ws-workspace so
// unified and split layouts share ONE filter. The apply function is pure + exported
// so it can be unit-tested and memoized at the call site.
import { useState } from "react";
import type { Frame, FrameDir } from "../transport/transport";

export function useLogFilter() {
  // Empty `dirs` = no direction restriction (show all). Toggling a chip adds/removes it.
  const [dirs, setDirs] = useState<Set<FrameDir>>(() => new Set());
  const [text, setText] = useState("");

  const toggleDir = (d: FrameDir) =>
    setDirs((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const clear = () => {
    setDirs(new Set());
    setText("");
  };

  const active = dirs.size > 0 || text.trim().length > 0;
  return { dirs, text, setText, toggleDir, clear, active };
}

/** Filter frames by direction (empty set = all) and a case-insensitive text match
 *  over the rendered kind + summary-ish body. Pure — no React, safe to memoize. */
export function applyLogFilter(frames: Frame[], dirs: Set<FrameDir>, text: string): Frame[] {
  const t = text.trim().toLowerCase();
  if (dirs.size === 0 && !t) return frames;
  return frames.filter((f) => {
    if (dirs.size && !dirs.has(f.dir)) return false;
    if (t) {
      const body = typeof f.body === "string" ? f.body : JSON.stringify(f.body ?? "");
      if (!f.kind.toLowerCase().includes(t) && !body.toLowerCase().includes(t)) return false;
    }
    return true;
  });
}
