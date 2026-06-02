// Highlighted YAML/XML/Text views + the format-dispatching FormatView.
// Ported from design/formats.jsx.
import { yamlStringify, splitKeyVal } from "./yaml";
import { xmlStringify } from "./xml";
import { JsonView } from "./json-view";
import type { Format } from "./serialize";

function valClass(tok: string): string {
  tok = tok.trim();
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(tok)) return "j-num";
  if (/^(true|false|null|~)$/.test(tok)) return "j-lit";
  if (tok[0] === "[" || tok[0] === "{") return "";
  return "j-str";
}

export function YamlView({ value }: { value: unknown }) {
  const text = yamlStringify(value);
  const nodes = text.split("\n").map((line, idx) => {
    const m = line.match(/^(\s*)(- )?(.*)$/) as RegExpMatchArray;
    const [, ws, dash, rest] = m;
    const kv = splitKeyVal(rest);
    let inner: React.ReactNode;
    if (kv && kv.key !== "") {
      const bits: React.ReactNode[] = [
        <span key="k" className="j-key">
          {kv.key}
        </span>,
        <span key="c">: </span>,
      ];
      if (kv.val !== "")
        bits.push(
          <span key="v" className={valClass(kv.val)}>
            {kv.val}
          </span>
        );
      inner = bits;
    } else {
      inner = <span className={rest === "" ? "" : valClass(rest)}>{rest}</span>;
    }
    return (
      <div key={idx} className="yml-line">
        <span>{ws}</span>
        {dash ? <span className="j-num">- </span> : null}
        {inner}
      </div>
    );
  });
  return <pre className="json yaml">{nodes}</pre>;
}

export function XmlView({ value }: { value: unknown }) {
  const xml = xmlStringify(value);
  const nodes = xml.split("\n").map((line, i) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let k = 0;
    let m: RegExpExecArray | null;
    const re = /<\/?[\w.$:-]+\/?>/g;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last)
        parts.push(
          <span key={k++} className="j-str">
            {line.slice(last, m.index)}
          </span>
        );
      parts.push(
        <span key={k++} className="xml-tag">
          {m[0]}
        </span>
      );
      last = m.index + m[0].length;
    }
    if (last < line.length)
      parts.push(
        <span key={k++} className="j-str">
          {line.slice(last)}
        </span>
      );
    return (
      <div key={i} className="yml-line">
        {parts}
      </div>
    );
  });
  return <pre className="json yaml">{nodes}</pre>;
}

export function TextView({ value }: { value: unknown }) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return <pre className="json text-view">{s}</pre>;
}

export function FormatView({ value, fmt }: { value: unknown; fmt: Format }) {
  if (fmt === "yaml") return <YamlView value={value} />;
  if (fmt === "xml") return <XmlView value={value} />;
  if (fmt === "text") return <TextView value={value} />;
  return <JsonView value={value} />;
}
