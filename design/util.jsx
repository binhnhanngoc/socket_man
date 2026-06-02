// util.jsx — formatting + JSON syntax view. Exports to window.
function prettyJSON(obj) {
  try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
}
function compactJSON(obj) {
  try { return JSON.stringify(obj); } catch (e) { return String(obj); }
}
function byteSize(obj) {
  const s = typeof obj === "string" ? obj : compactJSON(obj);
  return new Blob([s]).size;
}
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + String(d.getMilliseconds()).padStart(3, "0");
}
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

// Lightweight JSON syntax highlighter -> React nodes.
function JsonView({ value, compact }) {
  const text = compact ? compactJSON(value) : prettyJSON(value);
  // tokenize via regex, wrap in spans
  const parts = [];
  const re = /("(\\.|[^"\\])*"\s*:)|("(\\.|[^"\\])*")|(\b(true|false|null)\b)|(-?\d+\.?\d*([eE][+-]?\d+)?)/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    let cls = "j-num";
    if (m[1]) cls = "j-key";
    else if (m[3]) cls = "j-str";
    else if (m[5]) cls = "j-lit";
    parts.push(<span key={key++} className={cls}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <pre className={"json" + (compact ? " compact" : "")}>{parts}</pre>;
}

// Inline-editable label. Double-click the text (or call the render-prop's `begin`)
// to swap in an input; Enter / blur commits a trimmed, changed value, Escape cancels.
function EditableName({ value, onCommit, className, editClassName, title, renderIdle }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);
  const begin = (e) => { if (e) e.stopPropagation(); setDraft(value); setEditing(true); };
  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onCommit(v);
  };
  const cancel = () => { setEditing(false); setDraft(value); };

  if (editing) {
    return (
      <input ref={ref} className={"name-edit " + (editClassName || "")} value={draft}
        spellCheck="false"
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onBlur={commit} />
    );
  }
  if (renderIdle) return renderIdle({ begin });
  return (
    <span className={className} title={title || "Double-click to rename"}
      onDoubleClick={begin}>{value}</span>
  );
}

Object.assign(window, { prettyJSON, compactJSON, byteSize, fmtTime, fmtDur, JsonView, EditableName });
