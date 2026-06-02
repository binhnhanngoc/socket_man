// Hand-rolled XML serialize + DOMParser-based parse, ported from
// design/formats.jsx. Like YAML, this is a view + best-effort format, NOT a
// lossless round-trip: scalar values coerce on parse (numeric strings -> numbers)
// and arrays/repeated tags reshape. JSON is the gated lossless format.

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function xmlEsc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlEl(name: string, val: unknown, ind: number): string {
  const p = "  ".repeat(ind);
  if (Array.isArray(val)) return val.map((v) => xmlEl(name, v, ind)).join("\n");
  if (isObj(val)) {
    const inner = Object.keys(val)
      .map((k) => xmlEl(k, val[k], ind + 1))
      .join("\n");
    return p + "<" + name + ">\n" + inner + "\n" + p + "</" + name + ">";
  }
  if (val === null || val === undefined) return p + "<" + name + "/>";
  return p + "<" + name + ">" + xmlEsc(val) + "</" + name + ">";
}

export function xmlStringify(value: unknown, root = "message"): string {
  if (isObj(value)) {
    const inner = Object.keys(value)
      .map((k) => xmlEl(k, value[k], 1))
      .join("\n");
    return "<" + root + ">\n" + inner + "\n</" + root + ">";
  }
  if (Array.isArray(value)) {
    const inner = value.map((v) => xmlEl("item", v, 1)).join("\n");
    return "<" + root + ">\n" + inner + "\n</" + root + ">";
  }
  return "<" + root + ">" + xmlEsc(value) + "</" + root + ">";
}

function xmlCoerce(s: string): unknown {
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
  return s;
}

function elToObj(el: Element): unknown {
  const kids = Array.from(el.children);
  if (kids.length === 0) return xmlCoerce((el.textContent || "").trim());
  const obj: Record<string, unknown> = {};
  for (const c of kids) {
    const key = c.tagName;
    const val = elToObj(c);
    if (key in obj) {
      if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
      (obj[key] as unknown[]).push(val);
    } else obj[key] = val;
  }
  return obj;
}

export function xmlParse(text: string): unknown {
  const doc = new DOMParser().parseFromString(text.trim(), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML");
  if (!doc.documentElement) throw new Error("Empty XML");
  return elToObj(doc.documentElement);
}
