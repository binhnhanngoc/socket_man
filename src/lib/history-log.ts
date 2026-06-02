// Append a TEMPLATE-form history entry via the Rust `history_append` command (which
// caps + serializes under the file lock). Call sites pass pre-resolution data only —
// secret tokens stay literal `{{token}}`, so no resolved secret can reach history.

import type { HistoryEntry } from "../types";
import { transport } from "../transport";

const uid = () => "h-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function appendHistory(entry: Omit<HistoryEntry, "id" | "ts">): void {
  const full: HistoryEntry = { id: uid(), ts: Date.now(), ...entry };
  transport.historyAppend(full).catch(() => {});
}
