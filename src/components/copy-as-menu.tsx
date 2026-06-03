// Small "Copy as ▾" dropdown. Closes on selection or when focus leaves the menu.
import { useState } from "react";
import { IconCopy, IconChevron } from "./icons";

interface CopyAsMenuProps<T extends string> {
  targets: { id: T; label: string }[];
  onPick: (target: T) => void;
  title?: string;
  label?: string;
}

export function CopyAsMenu<T extends string>({ targets, onPick, title = "Copy as…", label = "Copy as" }: CopyAsMenuProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="copy-as"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button className="copy-as-btn" title={title} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <IconCopy size={14} />
        {label}
        <IconChevron size={12} open={open} />
      </button>
      {open && (
        <div className="copy-as-menu" role="menu">
          {targets.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              className="copy-as-item"
              onClick={() => {
                setOpen(false);
                onPick(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
