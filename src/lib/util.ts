// Formatting helpers ported from design/util.jsx. Pure functions, no globals.

export function prettyJSON(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function compactJSON(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/** Byte length of a value's compact-JSON (or raw string) representation. */
export function byteSize(obj: unknown): number {
  const s = typeof obj === "string" ? obj : compactJSON(obj);
  return new Blob([s]).size;
}

/** "HH:MM:SS.mmm" wall-clock time for a frame timestamp. */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    p(d.getHours()) +
    ":" +
    p(d.getMinutes()) +
    ":" +
    p(d.getSeconds()) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

/** "MM:SS" elapsed duration for a connection timer. */
export function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
