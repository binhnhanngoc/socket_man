// Resizable / collapsible layout panels (sidebar + message library widths,
// sidebar collapse). Ported from the panel state in design/app.jsx. Each value
// persists to localStorage independently.
import { useCallback, useState } from "react";

const SIDEBAR_DEF = 260;
const LIBRARY_DEF = 332;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function readW(key: string, def: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) || "", 10);
    if (!isNaN(v)) return v;
  } catch {
    // ignore
  }
  return def;
}

function writeW(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // ignore
  }
}

export function usePanels() {
  const [sidebarW, setSidebarW] = useState(() => readW("relay.sidebarW", SIDEBAR_DEF));
  const [libraryW, setLibraryW] = useState(() => readW("relay.libraryW", LIBRARY_DEF));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("relay.sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      writeW("relay.sidebarCollapsed", v ? 0 : 1);
      return !v;
    });
  }, []);

  const resizeSidebar = useCallback((dx: number) => {
    setSidebarW((w) => {
      const n = clamp(w + dx, 200, 440);
      writeW("relay.sidebarW", n);
      return n;
    });
  }, []);
  const resizeLibrary = useCallback((dx: number) => {
    setLibraryW((w) => {
      const n = clamp(w + dx, 248, 600);
      writeW("relay.libraryW", n);
      return n;
    });
  }, []);
  const resetSidebar = useCallback(() => {
    setSidebarW(SIDEBAR_DEF);
    writeW("relay.sidebarW", SIDEBAR_DEF);
  }, []);
  const resetLibrary = useCallback(() => {
    setLibraryW(LIBRARY_DEF);
    writeW("relay.libraryW", LIBRARY_DEF);
  }, []);

  return {
    sidebarW,
    libraryW,
    sidebarCollapsed,
    toggleSidebar,
    resizeSidebar,
    resizeLibrary,
    resetSidebar,
    resetLibrary,
  };
}
