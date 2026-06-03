// HttpRequest → curl. Multi-line with backslash continuations for readability.
import { shellSingleQuote } from "./escape";
import type { CodegenHttp } from "./types";

export function toCurl({ method, url, headers, body }: CodegenHttp): string {
  const parts: string[] = [`curl -X ${method.toUpperCase()} ${shellSingleQuote(url)}`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`-H ${shellSingleQuote(`${k}: ${v}`)}`);
  }
  if (body && body.trim() !== "") {
    parts.push(`--data ${shellSingleQuote(body)}`);
  }
  return parts.join(" \\\n  ");
}
