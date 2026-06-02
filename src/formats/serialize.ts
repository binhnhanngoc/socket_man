// Format-agnostic serialize/parse dispatch, ported from design/formats.jsx.
// JSON is the gated lossless format; yaml/xml/text are view + best-effort.

import { yamlStringify, yamlParse } from "./yaml";
import { xmlStringify, xmlParse } from "./xml";

export type Format = "json" | "yaml" | "xml" | "text";

export function serialize(obj: unknown, fmt: Format): string {
  if (fmt === "yaml") return yamlStringify(obj);
  if (fmt === "xml") return xmlStringify(obj);
  if (fmt === "text") return typeof obj === "string" ? obj : JSON.stringify(obj);
  return JSON.stringify(obj, null, 2);
}

export function parseFmt(text: string, fmt: Format): unknown {
  if (fmt === "yaml") return yamlParse(text);
  if (fmt === "xml") return xmlParse(text);
  if (fmt === "text") {
    const t = text.trim();
    if (t && (t[0] === "{" || t[0] === "[")) {
      try {
        return JSON.parse(t);
      } catch {
        // fall through to returning the raw text
      }
    }
    return text;
  }
  return JSON.parse(text);
}
