// Inline-editable label, ported from design/util.jsx. Double-click (or call the
// render-prop's `begin`) swaps in an input; Enter/blur commits a trimmed,
// changed value; Escape cancels.
import { useEffect, useRef, useState } from "react";

interface EditableNameProps {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  editClassName?: string;
  title?: string;
  renderIdle?: (api: { begin: (e?: React.SyntheticEvent) => void }) => React.ReactNode;
}

export function EditableName({ value, onCommit, className, editClassName, title, renderIdle }: EditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  const begin = (e?: React.SyntheticEvent) => {
    if (e) e.stopPropagation();
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== value) onCommit(v);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        className={"name-edit " + (editClassName || "")}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
      />
    );
  }
  if (renderIdle) return <>{renderIdle({ begin })}</>;
  return (
    <span className={className} title={title || "Double-click to rename"} onDoubleClick={begin}>
      {value}
    </span>
  );
}
