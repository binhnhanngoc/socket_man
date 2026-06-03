// HttpRequest → fetch(url, { method, headers, body }). Valid JS the user can paste.
import { jsString } from "./escape";
import type { CodegenHttp } from "./types";

export function toFetch({ method, url, headers, body }: CodegenHttp): string {
  const opts: string[] = [`  method: ${jsString(method.toUpperCase())}`];
  const headerKeys = Object.keys(headers);
  if (headerKeys.length > 0) {
    const lines = headerKeys.map((k) => `    ${jsString(k)}: ${jsString(headers[k])}`);
    opts.push(`  headers: {\n${lines.join(",\n")}\n  }`);
  }
  if (body && body.trim() !== "") {
    opts.push(`  body: ${jsString(body)}`);
  }
  return `fetch(${jsString(url)}, {\n${opts.join(",\n")}\n});`;
}
