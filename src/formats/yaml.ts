// Hand-rolled YAML serialize + indentation-based parse, ported from
// design/formats.jsx. KNOWN LIMITATIONS (documented + tested as such, NOT a
// lossless round-trip — see formats round-trip test): single-element arrays can
// round-trip to strings, numeric-looking strings coerce to numbers, and
// null/empty values collapse. YAML is a view + best-effort format here; JSON is
// the gated lossless format.

function yScalar(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (
    s === "" ||
    /^\s|\s$/.test(s) ||
    /[:#[\]{}&*!|>'"%@`,]/.test(s) ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
    /^[-?]/.test(s) ||
    /^\d/.test(s)
  ) {
    return JSON.stringify(s);
  }
  return s;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function yamlStringify(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + "[]";
    return value
      .map((v) => {
        if (isObj(v) || Array.isArray(v)) {
          const body = yamlStringify(v, indent + 1);
          const lines = body.split("\n");
          lines[0] = pad + "- " + lines[0].slice((indent + 1) * 2);
          return lines.join("\n");
        }
        return pad + "- " + yScalar(v);
      })
      .join("\n");
  }
  if (isObj(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return pad + "{}";
    return keys
      .map((k) => {
        const v = value[k];
        const key = /^[\w.$-]+$/.test(k) ? k : JSON.stringify(k);
        if (Array.isArray(v) && v.length) return pad + key + ":\n" + yamlStringify(v, indent + 1);
        if (isObj(v) && Object.keys(v).length) return pad + key + ":\n" + yamlStringify(v, indent + 1);
        if (Array.isArray(v)) return pad + key + ": []";
        if (isObj(v)) return pad + key + ": {}";
        return pad + key + ": " + yScalar(v);
      })
      .join("\n");
  }
  return pad + yScalar(value);
}

// ---------- YAML parse (indentation-based subset) ----------
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q: string | null = null;
  let cur = "";
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

function yParseScalar(tok: string): unknown {
  tok = tok.trim();
  if (tok === "") return null;
  if (tok[0] === '"') {
    try {
      return JSON.parse(tok);
    } catch {
      return tok.slice(1, -1);
    }
  }
  if (tok[0] === "'") return tok.slice(1, -1).replace(/''/g, "'");
  if (tok[0] === "[" && tok[tok.length - 1] === "]") {
    const inner = tok.slice(1, -1).trim();
    return inner ? splitFlow(inner).map((x) => yParseScalar(x)) : [];
  }
  if (tok[0] === "{" && tok[tok.length - 1] === "}") {
    const inner = tok.slice(1, -1).trim();
    const o: Record<string, unknown> = {};
    if (inner)
      splitFlow(inner).forEach((p) => {
        const k = p.indexOf(":");
        o[String(yParseScalar(p.slice(0, k)))] = yParseScalar(p.slice(k + 1));
      });
    return o;
  }
  if (tok === "null" || tok === "~") return null;
  if (tok === "true") return true;
  if (tok === "false") return false;
  if (/^-?\d+$/.test(tok)) return parseInt(tok, 10);
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) return parseFloat(tok);
  return tok;
}

function splitKeyVal(text: string): { key: string; val: string } | null {
  let q: string | null = null;
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === ":" && (j === text.length - 1 || text[j + 1] === " ")) {
      return { key: text.slice(0, j).trim(), val: text.slice(j + 1).trim() };
    }
  }
  return null;
}

interface YLine {
  indent: number;
  text: string;
}

export function yamlParse(text: string): unknown {
  const all = text.replace(/\r/g, "").replace(/\t/g, "  ").split("\n");
  const lines: YLine[] = [];
  for (const l of all) {
    const t = l.replace(/\s+$/, "");
    if (!t.trim() || t.trim().startsWith("#")) continue;
    lines.push({ indent: (t.match(/^ */) as RegExpMatchArray)[0].length, text: t.trim() });
  }
  if (!lines.length) return null;
  let i = 0;

  function node(ind: number): unknown {
    return lines[i].text.startsWith("- ") || lines[i].text === "-" ? seq(ind) : map(ind);
  }
  function seq(indent: number): unknown[] {
    const arr: unknown[] = [];
    while (
      i < lines.length &&
      lines[i].indent === indent &&
      (lines[i].text.startsWith("- ") || lines[i].text === "-")
    ) {
      const after = lines[i].text === "-" ? "" : lines[i].text.slice(2);
      if (after === "") {
        i++;
        arr.push(i < lines.length && lines[i].indent > indent ? node(lines[i].indent) : null);
      } else if (splitKeyVal(after)) {
        lines[i] = { indent: indent + 2, text: after };
        arr.push(map(indent + 2));
      } else {
        arr.push(yParseScalar(after));
        i++;
      }
    }
    return arr;
  }
  function map(indent: number): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
      const kv = splitKeyVal(lines[i].text);
      if (!kv) {
        i++;
        continue;
      }
      const key = String(yParseScalar(kv.key));
      if (kv.val === "") {
        i++;
        if (i < lines.length && lines[i].indent > indent) obj[key] = node(lines[i].indent);
        else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- "))
          obj[key] = seq(indent);
        else obj[key] = null;
      } else {
        obj[key] = yParseScalar(kv.val);
        i++;
      }
    }
    return obj;
  }

  if (lines.length === 1 && !splitKeyVal(lines[0].text) && !lines[0].text.startsWith("-"))
    return yParseScalar(lines[0].text);
  return node(lines[0].indent);
}

// Exposed for the highlighted YAML view (formats/format-view.tsx).
export { splitKeyVal };
