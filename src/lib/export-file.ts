// Copy-to-clipboard + save-to-file helpers. Save dispatches over the Transport
// seam (`exportSave`) so components never touch Tauri plugins directly; the mock
// transport degrades to a Blob download. All outcomes route through Phase 1 toasts.
//
// SECURITY: exports carry TEMPLATES only. The HTTP body is server-returned text;
// the WS frame log already stores template bodies (secrets resolved Rust-side on the
// outbound path and never logged). Nothing here resolves a secret.
import { transport } from "../transport";
import type { Frame } from "../transport/transport";
import { pushToast } from "../hooks/use-toasts";

export const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];
export const TEXT_FILTER = [{ name: "Text", extensions: ["txt"] }];
// Frame log offers both shapes; the user's chosen extension selects the serializer.
const FRAME_FILTERS = [
  { name: "JSON frames", extensions: ["json"] },
  { name: "Text log", extensions: ["txt"] },
];

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function legacyCopy(s: string) {
  // Fallback when the async Clipboard API is unavailable (older webview / no perm).
  const ta = document.createElement("textarea");
  ta.value = s;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy command rejected");
}

export async function copyText(s: string, label = "Copied to clipboard"): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
    } else {
      legacyCopy(s);
    }
    pushToast({ kind: "success", message: label });
  } catch {
    try {
      legacyCopy(s);
      pushToast({ kind: "success", message: label });
    } catch {
      pushToast({ kind: "error", message: "Couldn't copy to clipboard" });
    }
  }
}

/** Save a single string to a user-chosen file. `filters` seeds the dialog. */
export async function saveText(
  suggestedName: string,
  contents: string,
  filters = TEXT_FILTER
): Promise<void> {
  try {
    const path = await transport.exportSave(suggestedName, filters, () => contents);
    if (path) pushToast({ kind: "success", message: `Saved ${basename(path)}` });
  } catch {
    pushToast({ kind: "error", message: "Couldn't save file" });
  }
}

const DIR_LABEL: Record<Frame["dir"], string> = { out: "SENT", in: "RECV", sys: "SYS" };

export function framesToJson(frames: Frame[]): string {
  // Structured array: stable, parseable, templates intact.
  return JSON.stringify(
    frames.map((f) => ({ dir: f.dir, kind: f.kind, ts: f.ts, size: f.size, body: f.body })),
    null,
    2
  );
}

export function framesToText(frames: Frame[]): string {
  return frames
    .map((f) => {
      const t = new Date(f.ts).toISOString();
      const body = typeof f.body === "string" ? f.body : JSON.stringify(f.body);
      return `[${t}] ${DIR_LABEL[f.dir]} ${f.kind} (${f.size}B) ${body}`;
    })
    .join("\n");
}

/** Export the (already filtered/visible) frame log; user picks .json or .txt. */
export async function saveFrameLog(frames: Frame[]): Promise<void> {
  try {
    const path = await transport.exportSave("frame-log.json", FRAME_FILTERS, (ext) =>
      ext === "txt" ? framesToText(frames) : framesToJson(frames)
    );
    if (path) pushToast({ kind: "success", message: `Exported ${basename(path)}` });
  } catch {
    pushToast({ kind: "error", message: "Couldn't export log" });
  }
}
