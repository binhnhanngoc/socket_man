// YAML serialize/parse backed by js-yaml (JSON schema). The JSON schema keeps
// type coercion aligned with our JSON data model — no YAML 1.1 footguns (sexagesimal
// `02:00`, yes/no→bool) — and js-yaml quotes ambiguous strings on dump so they parse
// back as strings. Our object payloads round-trip losslessly (see format-round-trip
// test). JSON remains the gated lossless format for arbitrary external input.
import yaml from "js-yaml";

const DUMP_OPTS: yaml.DumpOptions = {
  schema: yaml.JSON_SCHEMA,
  indent: 2,
  lineWidth: -1, // no line folding — keep long scalars on one line
  noRefs: true, // never emit anchors/aliases
};

export function yamlStringify(value: unknown): string {
  // js-yaml appends a trailing newline; trim it so the highlighted view has no
  // empty trailing line and output matches the previous hand-rolled serializer.
  return yaml.dump(value, DUMP_OPTS).replace(/\n+$/, "");
}

export function yamlParse(text: string): unknown {
  const value = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  // js-yaml returns `undefined` for empty/comment-only input — normalize to null.
  return value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// splitKeyVal — a line-level "key: value" splitter used by the highlighted YAML
// view (formats/format-view.tsx). It is independent of the parse engine: it tokens
// a single rendered line into its key + value parts for syntax coloring.
// ---------------------------------------------------------------------------
export function splitKeyVal(text: string): { key: string; val: string } | null {
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
