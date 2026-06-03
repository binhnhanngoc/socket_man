// Frame-log filter bar: direction toggle chips (Sent/Received/System) + a free-text
// match input + a live match count. State lives in ws-workspace (use-log-filter) so
// unified and split layouts share one filter.
import type { FrameDir } from "../transport/transport";
import { IconSearch, IconX } from "./icons";

const DIRS: [FrameDir, string][] = [
  ["out", "Sent"],
  ["in", "Received"],
  ["sys", "System"],
];

interface LogFilterBarProps {
  dirs: Set<FrameDir>;
  text: string;
  active: boolean;
  count: number;
  total: number;
  onToggleDir: (d: FrameDir) => void;
  onText: (t: string) => void;
  onClear: () => void;
}

export function LogFilterBar({ dirs, text, active, count, total, onToggleDir, onText, onClear }: LogFilterBarProps) {
  return (
    <div className="log-filter">
      <div className="seg">
        {DIRS.map(([d, label]) => (
          <button
            key={d}
            className={"seg-btn" + (dirs.has(d) ? " on" : "")}
            aria-pressed={dirs.has(d)}
            onClick={() => onToggleDir(d)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="log-search">
        <IconSearch size={13} />
        <input
          className="log-search-input"
          value={text}
          placeholder="Filter messages…"
          spellCheck={false}
          aria-label="Filter messages"
          onChange={(e) => onText(e.target.value)}
        />
        {active && (
          <button className="log-search-clear" title="Clear filter" onClick={onClear}>
            <IconX size={13} />
          </button>
        )}
      </div>
      <span className="log-match-count" title="matches / total">
        {active ? `${count} / ${total}` : total}
      </span>
    </div>
  );
}
