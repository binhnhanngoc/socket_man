// use-history — read/clear the persisted history log. APPEND is NOT here: it goes
// through the Rust `history_append` command at the call sites (use-http on response,
// the workspace store on WS disconnect) so the entry is written TEMPLATE-form under
// the file lock, never a frontend read-modify-write of resolved connection state.

import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry } from "../types";
import { transport } from "../transport";

export function useHistory(open: boolean) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const refresh = useCallback(() => {
    transport
      .storageLoad("history")
      .then((d) => setEntries(Array.isArray(d) ? (d as HistoryEntry[]) : []))
      .catch(() => setEntries([]));
  }, []);

  // Reload whenever the panel opens (appends happen elsewhere; this re-reads).
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const clear = useCallback(() => {
    transport
      .storageSave("history", [])
      .then(() => setEntries([]))
      .catch(() => {});
  }, []);

  return { entries, refresh, clear };
}
