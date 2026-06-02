// formats.jsx — JSON/YAML serialize, parse, and highlighted views. Exports to window.

// ---------- YAML serialize ----------
function yScalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (s === "" || /^\s|\s$/.test(s) || /[:#\[\]{}&*!|>'"%@`,]/.test(s) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^[-?]/.test(s) || /^\d/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

function yamlStringify(value, indent) {
  indent = indent || 0;
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return pad + "[]";
    return value.map((v) => {
      if (isObj(v) || Array.isArray(v)) {
        const body = yamlStringify(v, indent + 1);
        const lines = body.split("\n");
        lines[0] = pad + "- " + lines[0].slice((indent + 1) * 2);
        return lines.join("\n");
      }
      return pad + "- " + yScalar(v);
    }).join("\n");
  }
  if (isObj(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return pad + "{}";
    return keys.map((k) => {
      const v = value[k];
      const key = /^[\w.$-]+$/.test(k) ? k : JSON.stringify(k);
      if (Array.isArray(v) && v.length) return pad + key + ":\n" + yamlStringify(v, indent + 1);
      if (isObj(v) && Object.keys(v).length) return pad + key + ":\n" + yamlStringify(v, indent + 1);
      if (Array.isArray(v)) return pad + key + ": []";
      if (isObj(v)) return pad + key + ": {}";
      return pad + key + ": " + yScalar(v);
    }).join("\n");
  }
  return pad + yScalar(value);
}

// ---------- YAML parse (indentation-based subset) ----------
function splitFlow(s) {
  const out = []; let depth = 0, q = null, cur = "";
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}
function yParseScalar(tok) {
  tok = tok.trim();
  if (tok === "") return null;
  if (tok[0] === '"') { try { return JSON.parse(tok); } catch (e) { return tok.slice(1, -1); } }
  if (tok[0] === "'") return tok.slice(1, -1).replace(/''/g, "'");
  if (tok[0] === "[" && tok[tok.length - 1] === "]") {
    const inner = tok.slice(1, -1).trim();
    return inner ? splitFlow(inner).map((x) => yParseScalar(x)) : [];
  }
  if (tok[0] === "{" && tok[tok.length - 1] === "}") {
    const inner = tok.slice(1, -1).trim(); const o = {};
    if (inner) splitFlow(inner).forEach((p) => { const k = p.indexOf(":"); o[yParseScalar(p.slice(0, k))] = yParseScalar(p.slice(k + 1)); });
    return o;
  }
  if (tok === "null" || tok === "~") return null;
  if (tok === "true") return true;
  if (tok === "false") return false;
  if (/^-?\d+$/.test(tok)) return parseInt(tok, 10);
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) return parseFloat(tok);
  return tok;
}
function splitKeyVal(text) {
  let q = null;
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ":" && (j === text.length - 1 || text[j + 1] === " ")) {
      return { key: text.slice(0, j).trim(), val: text.slice(j + 1).trim() };
    }
  }
  return null;
}
function yamlParse(text) {
  const all = text.replace(/\r/g, "").replace(/\t/g, "  ").split("\n");
  const lines = [];
  for (const l of all) {
    const t = l.replace(/\s+$/, "");
    if (!t.trim() || t.trim().startsWith("#")) continue;
    lines.push({ indent: t.match(/^ */)[0].length, text: t.trim() });
  }
  if (!lines.length) return null;
  let i = 0;
  function node(ind) {
    return (lines[i].text.startsWith("- ") || lines[i].text === "-") ? seq(ind) : map(ind);
  }
  function seq(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
      const after = lines[i].text === "-" ? "" : lines[i].text.slice(2);
      if (after === "") {
        i++;
        arr.push(i < lines.length && lines[i].indent > indent ? node(lines[i].indent) : null);
      } else if (splitKeyVal(after)) {
        lines[i] = { indent: indent + 2, text: after };
        arr.push(map(indent + 2));
      } else { arr.push(yParseScalar(after)); i++; }
    }
    return arr;
  }
  function map(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
      const kv = splitKeyVal(lines[i].text);
      if (!kv) { i++; continue; }
      const key = yParseScalar(kv.key);
      if (kv.val === "") {
        i++;
        if (i < lines.length && lines[i].indent > indent) obj[key] = node(lines[i].indent);
        else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) obj[key] = seq(indent);
        else obj[key] = null;
      } else { obj[key] = yParseScalar(kv.val); i++; }
    }
    return obj;
  }
  if (lines.length === 1 && !splitKeyVal(lines[0].text) && !lines[0].text.startsWith("-")) return yParseScalar(lines[0].text);
  return node(lines[0].indent);
}

// ---------- XML serialize / parse ----------
function xmlEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function xmlEl(name, val, ind) {
  const p = "  ".repeat(ind);
  if (Array.isArray(val)) return val.map((v) => xmlEl(name, v, ind)).join("\n");
  if (isObj(val)) {
    const inner = Object.keys(val).map((k) => xmlEl(k, val[k], ind + 1)).join("\n");
    return p + "<" + name + ">\n" + inner + "\n" + p + "</" + name + ">";
  }
  if (val === null || val === undefined) return p + "<" + name + "/>";
  return p + "<" + name + ">" + xmlEsc(val) + "</" + name + ">";
}
function xmlStringify(value, root) {
  root = root || "message";
  if (isObj(value)) {
    const inner = Object.keys(value).map((k) => xmlEl(k, value[k], 1)).join("\n");
    return "<" + root + ">\n" + inner + "\n</" + root + ">";
  }
  if (Array.isArray(value)) {
    const inner = value.map((v) => xmlEl("item", v, 1)).join("\n");
    return "<" + root + ">\n" + inner + "\n</" + root + ">";
  }
  return "<" + root + ">" + xmlEsc(value) + "</" + root + ">";
}
function xmlCoerce(s) {
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
  return s;
}
function elToObj(el) {
  const kids = Array.from(el.children);
  if (kids.length === 0) return xmlCoerce(el.textContent.trim());
  const obj = {};
  for (const c of kids) {
    const key = c.tagName, val = elToObj(c);
    if (key in obj) { if (!Array.isArray(obj[key])) obj[key] = [obj[key]]; obj[key].push(val); }
    else obj[key] = val;
  }
  return obj;
}
function xmlParse(text) {
  const doc = new DOMParser().parseFromString(text.trim(), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML");
  if (!doc.documentElement) throw new Error("Empty XML");
  return elToObj(doc.documentElement);
}

// ---------- format-agnostic helpers ----------
function serialize(obj, fmt) {
  if (fmt === "yaml") return yamlStringify(obj);
  if (fmt === "xml") return xmlStringify(obj);
  if (fmt === "text") return typeof obj === "string" ? obj : JSON.stringify(obj);
  return JSON.stringify(obj, null, 2);
}
function parseFmt(text, fmt) {
  if (fmt === "yaml") return yamlParse(text);
  if (fmt === "xml") return xmlParse(text);
  if (fmt === "text") {
    const t = text.trim();
    if (t && (t[0] === "{" || t[0] === "[")) { try { return JSON.parse(t); } catch (e) {} }
    return text;
  }
  return JSON.parse(text);
}

// ---------- YAML highlighted view ----------
function YamlView({ value }) {
  const text = yamlStringify(value);
  const nodes = text.split("\n").map((line, idx) => {
    const m = line.match(/^(\s*)(- )?(.*)$/);
    const [, ws, dash, rest] = m;
    const kv = splitKeyVal(rest);
    let inner;
    if (kv && kv.key !== "") {
      inner = [<span key="k" className="j-key">{kv.key}</span>, <span key="c">: </span>];
      if (kv.val !== "") inner.push(<span key="v" className={valClass(kv.val)}>{kv.val}</span>);
    } else {
      inner = <span className={rest === "" ? "" : valClass(rest)}>{rest}</span>;
    }
    return (
      <div key={idx} className="yml-line">
        <span>{ws}</span>{dash ? <span className="j-num">- </span> : null}{inner}
      </div>
    );
  });
  return <pre className="json yaml">{nodes}</pre>;
}
function valClass(tok) {
  tok = tok.trim();
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) return "j-num";
  if (/^(true|false|null|~)$/.test(tok)) return "j-lit";
  if (tok[0] === "[" || tok[0] === "{") return "";
  return "j-str";
}
function XmlView({ value }) {
  const xml = xmlStringify(value);
  const nodes = xml.split("\n").map((line, i) => {
    const parts = []; let last = 0, k = 0, m;
    const re = /<\/?[\w.$:-]+\/?>/g;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) parts.push(<span key={k++} className="j-str">{line.slice(last, m.index)}</span>);
      parts.push(<span key={k++} className="xml-tag">{m[0]}</span>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(<span key={k++} className="j-str">{line.slice(last)}</span>);
    return <div key={i} className="yml-line">{parts}</div>;
  });
  return <pre className="json yaml">{nodes}</pre>;
}
function TextView({ value }) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return <pre className="json text-view">{s}</pre>;
}
function FormatView({ value, fmt }) {
  if (fmt === "yaml") return <YamlView value={value} />;
  if (fmt === "xml") return <XmlView value={value} />;
  if (fmt === "text") return <TextView value={value} />;
  return <JsonView value={value} />;
}

Object.assign(window, { yamlStringify, yamlParse, xmlStringify, xmlParse, serialize, parseFmt, YamlView, XmlView, TextView, FormatView });
