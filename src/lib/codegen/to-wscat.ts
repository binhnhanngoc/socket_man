// ConnectConfig → wscat. `wscat -c <url>` with one `-H "Key: Value"` per header.
import { shellSingleQuote } from "./escape";
import type { CodegenWs } from "./types";

export function toWscat({ url, headers }: CodegenWs): string {
  const parts: string[] = [`wscat -c ${shellSingleQuote(url)}`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`-H ${shellSingleQuote(`${k}: ${v}`)}`);
  }
  return parts.join(" \\\n  ");
}
