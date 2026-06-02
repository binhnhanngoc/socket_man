// Draggable column resizer, ported from design/app.jsx.
import { useRef, useState } from "react";

interface ResizerProps {
  onResize: (dx: number) => void;
  onReset: () => void;
  label?: string;
}

export function Resizer({ onResize, onReset, label }: ResizerProps) {
  const [drag, setDrag] = useState(false);
  const last = useRef(0);

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    last.current = e.clientX;
    setDrag(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: MouseEvent) => {
      onResize(ev.clientX - last.current);
      last.current = ev.clientX;
    };
    const up = () => {
      setDrag(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      className={"resizer" + (drag ? " dragging" : "")}
      onMouseDown={onDown}
      onDoubleClick={onReset}
      role="separator"
      aria-orientation="vertical"
      title={(label || "Drag to resize") + " · double-click to reset"}
    ></div>
  );
}
