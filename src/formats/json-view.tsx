// Lightweight JSON syntax highlighter -> React nodes. Ported from design/util.jsx.
import { prettyJSON, compactJSON } from "../lib/util";

export function JsonView({ value, compact }: { value: unknown; compact?: boolean }) {
  const text = compact ? compactJSON(value) : prettyJSON(value);
  const parts: React.ReactNode[] = [];
  const re =
    /("(\\.|[^"\\])*"\s*:)|("(\\.|[^"\\])*")|(\b(true|false|null)\b)|(-?\d+\.?\d*([eE][+-]?\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    let cls = "j-num";
    if (m[1]) cls = "j-key";
    else if (m[3]) cls = "j-str";
    else if (m[5]) cls = "j-lit";
    parts.push(
      <span key={key++} className={cls}>
        {tok}
      </span>
    );
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <pre className={"json" + (compact ? " compact" : "")}>{parts}</pre>;
}
