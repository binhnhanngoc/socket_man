// Toast host — fixed-position stack rendering active toasts from the module-level
// use-toasts store. Mounted exactly once near the app root (see App.tsx).
import { useToasts, dismiss } from "../hooks/use-toasts";
import { IconX } from "./icons";

export function ToastHost() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast toast-" + t.kind} role={t.kind === "error" ? "alert" : "status"}>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-dismiss" title="Dismiss" onClick={() => dismiss(t.id)}>
            <IconX size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
