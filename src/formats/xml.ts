// XML serialize/parse backed by fast-xml-parser. Like YAML this is a view +
// best-effort format — the XML data model has NO array concept and no type info,
// so some shapes are inherently lossy (single-element arrays collapse, numeric-
// looking text coerces to numbers, null renders empty and parses back to ""). JSON
// is the gated lossless format. The library handles escaping + structure correctly;
// the remaining losses are XML's, not the parser's.
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

const ROOT = "message";

const builder = new XMLBuilder({ format: true, indentBy: "  ", processEntities: true });
const parser = new XMLParser({ ignoreAttributes: true, processEntities: true });

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function xmlStringify(value: unknown, root = ROOT): string {
  // An array root has no natural tag, so wrap each element as <item> (mirrors the
  // previous serializer). Objects/scalars nest directly under the root tag.
  const wrapped = Array.isArray(value) ? { [root]: { item: value } } : { [root]: value };
  return (builder.build(wrapped) as string).replace(/\n+$/, "");
}

export function xmlParse(text: string, root = ROOT): unknown {
  const t = text.trim();
  // fast-xml-parser is best-effort and won't throw on malformed input — validate
  // first so callers get the same "Invalid XML" failure the DOMParser path gave.
  if (XMLValidator.validate(t) !== true) throw new Error("Invalid XML");
  const parsed = parser.parse(t) as Record<string, unknown>;
  const keys = Object.keys(parsed).filter((k) => k !== "?xml");
  if (keys.length === 0) throw new Error("Empty XML");
  const inner = parsed[keys[0]];
  // Unwrap the array-root convention (<message><item>…</item></message>).
  if (keys[0] === root && isObj(inner) && Object.keys(inner).length === 1 && Array.isArray(inner.item)) {
    return inner.item;
  }
  return inner;
}
