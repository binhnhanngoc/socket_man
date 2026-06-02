// useTweaks — UI preference store (density / dark / accent / log layout).
//
// REWRITTEN from design/tweaks-panel.jsx (F22): the prototype persisted via a
// host `window.parent.postMessage` edit-mode protocol. There is NO host in
// Tauri, so that path would silently never persist. This version persists to
// localStorage like every other UI pref, and the host edit-mode protocol is
// dropped entirely.
import { useCallback, useState } from "react";

export interface Tweaks {
  density: "compact" | "comfortable";
  dark: boolean;
  accent: string;
  logLayout: "unified" | "split";
}

export const TWEAK_DEFAULTS: Tweaks = {
  density: "comfortable",
  dark: false,
  accent: "#C44D1E",
  logLayout: "unified",
};

const STORAGE_KEY = "relay.tweaks";

function load(): Tweaks {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return { ...TWEAK_DEFAULTS, ...JSON.parse(s) };
  } catch {
    // ignore malformed storage
  }
  return TWEAK_DEFAULTS;
}

export function useTweaks(): [Tweaks, <K extends keyof Tweaks>(key: K, val: Tweaks[K]) => void] {
  const [values, setValues] = useState<Tweaks>(load);
  const setTweak = useCallback(<K extends keyof Tweaks>(key: K, val: Tweaks[K]) => {
    setValues((prev) => {
      const next = { ...prev, [key]: val };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota/serialization errors
      }
      return next;
    });
  }, []);
  return [values, setTweak];
}
