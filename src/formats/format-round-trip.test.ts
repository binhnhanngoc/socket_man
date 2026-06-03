import { describe, it, expect } from "vitest";
import { serialize, parseFmt } from "./serialize";

// ---------------------------------------------------------------------------
// Sample message bodies, mirroring the kinds of payloads the workbench sends
// (subscribe/config/control + nested telemetry-like objects).
// ---------------------------------------------------------------------------
const SAMPLES: { name: string; body: unknown }[] = [
  { name: "subscribe with fields array", body: { action: "subscribe", channel: "boiler.3", fields: ["kwh", "temp_c", "efficiency"] } },
  { name: "config scalars", body: { action: "config", sampleInterval: 5, unit: "s" } },
  { name: "control no args", body: { action: "ping" } },
  { name: "nested object", body: { action: "start", scenario: "A", shift: { bot: "B-021", window: "02:00-05:00" } } },
  { name: "booleans + null", body: { ok: true, retry: false, cursor: null, count: 0 } },
  { name: "numbers", body: { ints: [1, 2, 3], float: 3.14, negative: -42, zero: 0 } },
  { name: "deep mix", body: { a: { b: { c: [{ d: 1 }, { d: 2 }] } }, flag: true } },
];

// ===========================================================================
// JSON — the GATED lossless invariant. This MUST pass for every sample.
// ===========================================================================
describe("JSON round-trip (gated, lossless)", () => {
  for (const s of SAMPLES) {
    it(`losslessly round-trips: ${s.name}`, () => {
      expect(parseFmt(serialize(s.body, "json"), "json")).toEqual(s.body);
    });
  }
});

// ===========================================================================
// YAML — now backed by js-yaml (JSON schema). Our JSON-object payloads round-trip
// losslessly, INCLUDING the cases the old hand-rolled parser documented as lossy
// (single-element arrays, numeric-looking strings, nested arrays-of-arrays). The
// JSON schema avoids YAML 1.1 coercions (sexagesimal, yes/no→bool).
// ===========================================================================
describe("YAML round-trip (lossless for JSON-object payloads)", () => {
  for (const s of SAMPLES) {
    it(`losslessly round-trips: ${s.name}`, () => {
      expect(parseFmt(serialize(s.body, "yaml"), "yaml")).toEqual(s.body);
    });
  }

  // Previously DOCUMENTED-LOSSY cases — now lossless via js-yaml.
  const nowLossless: { name: string; body: unknown }[] = [
    { name: "single-element string array", body: { fields: ["only"] } },
    { name: "nested arrays-of-arrays", body: { grid: [[1, 2], [3, 4]] } },
    { name: "numeric-looking string (leading zero)", body: { code: "007" } },
    { name: "numeric-looking string", body: { code: "42" } },
  ];
  for (const s of nowLossless) {
    it(`(was lossy) now round-trips: ${s.name}`, () => {
      expect(parseFmt(serialize(s.body, "yaml"), "yaml")).toEqual(s.body);
    });
  }

  it("rejects malformed YAML by throwing", () => {
    expect(() => parseFmt("a:\n  - x\n -bad", "yaml")).toThrow();
  });
});

// ===========================================================================
// XML — backed by fast-xml-parser. A view + best-effort format: the XML data
// model has no array concept and no type info, so some shapes are INHERENTLY
// lossy regardless of parser. The lossless subset is asserted; the inherent
// losses are documented honestly (not hidden as false-green xfails).
// ===========================================================================
describe("XML round-trip (lossless subset + honest inherent losses)", () => {
  const xmlSafe: { name: string; body: unknown }[] = [
    { name: "nested object of strings", body: { scenario: "A", shift: { bot: "B-021", window: "02:00-05:00" } } },
    { name: "multi-key scalars", body: { unit: "s", note: "stable" } },
    { name: "multi-element string array", body: { fields: ["kwh", "temp_c", "efficiency"] } },
    { name: "integer scalars", body: { count: 5, zero: 0 } },
    { name: "booleans", body: { ok: true, retry: false } },
  ];
  for (const s of xmlSafe) {
    it(`round-trips within subset: ${s.name}`, () => {
      expect(parseFmt(serialize(s.body, "xml"), "xml")).toEqual(s.body);
    });
  }

  it("coerces numeric-looking text to a number (inherent XML limitation)", () => {
    const out = parseFmt(serialize({ code: "007" }, "xml"), "xml") as { code: unknown };
    expect(out.code).toBe(7);
  });

  it("renders null as empty text that parses back to '' (inherent XML limitation)", () => {
    const out = parseFmt(serialize({ cursor: null }, "xml"), "xml") as { cursor: unknown };
    expect(out.cursor).toBe("");
  });

  it("collapses a single-element array to a scalar (inherent XML limitation)", () => {
    const out = parseFmt(serialize({ fields: ["only"] }, "xml"), "xml") as { fields: unknown };
    expect(out.fields).toBe("only");
  });

  it("rejects malformed XML by throwing", () => {
    expect(() => parseFmt("<message><open></message>", "xml")).toThrow();
  });
});

// Text format: passthrough for strings; JSON-ish text parses to objects.
describe("Text format", () => {
  it("passes strings through unchanged", () => {
    expect(serialize("hello", "text")).toBe("hello");
    expect(parseFmt("hello", "text")).toBe("hello");
  });
  it("parses JSON-looking text into an object", () => {
    expect(parseFmt('{"a":1}', "text")).toEqual({ a: 1 });
  });
});
