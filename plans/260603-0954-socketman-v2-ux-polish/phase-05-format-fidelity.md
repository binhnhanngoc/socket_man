---
phase: 5
title: "Format Fidelity"
status: complete
priority: P3
effort: "0.5d"
dependencies: [1]
---

# Phase 5: Format Fidelity

## Overview

Replace the hand-rolled, documented-lossy YAML/XML parsers with soaked libraries (`js-yaml`,
`fast-xml-parser`) so the view/parse paths are accurate. The only behavior-touching phase — locked by the
existing round-trip tests, which get tightened (lossy cases become passing cases).

## Requirements

- **Functional:** `formats/yaml.ts` and `formats/xml.ts` use the libraries internally; the public
  `serialize(obj, fmt)` / `parseFmt(text, fmt)` dispatch in `serialize.ts` is UNCHANGED (signature + Format
  union stay identical). JSON remains the gated-lossless path; text path unchanged.
- **Non-functional:** previously-documented lossy cases (single-element-array collapse, numeric-string
  coercion, multi-doc YAML) now round-trip or are handled correctly. New libs must not introduce CSP
  `eval`/`new Function` (CSP gate must stay green). No change to callers (`format-view`, `http-response-view`).

## Architecture

- Add `js-yaml` + `@types/js-yaml`, `fast-xml-parser`.
- Rewrite `yaml.ts`: `yamlStringify` → `js-yaml.dump`; `yamlParse` → `js-yaml.load` (safe schema).
- Rewrite `xml.ts`: `xmlStringify` → `fast-xml-parser` `XMLBuilder`; `xmlParse` → `XMLParser`.
- Keep the exact exported function names (`yamlStringify/yamlParse`, `xmlStringify/xmlParse`) so
  `serialize.ts` needs no change.
- Update `format-round-trip.test.ts`: remove the "documented lossy" comments/expectations; assert the cases
  now round-trip. Keep JSON as the lossless keystone.

## Related Code Files

- Modify: `src/formats/yaml.ts`, `src/formats/xml.ts`, `src/formats/format-round-trip.test.ts`, `package.json`
- Read for context: `src/formats/serialize.ts`, `src/formats/format-view.tsx`, `src/formats/json-view.tsx`
- Verify unchanged: `serialize.ts` public API

## Implementation Steps

1. Add `js-yaml` (+ types) and `fast-xml-parser`; `npm run build` to confirm CSP gate stays green.
2. Rewrite `yaml.ts` over js-yaml, preserving export names.
3. Rewrite `xml.ts` over fast-xml-parser, preserving export names.
4. Tighten `format-round-trip.test.ts`: convert documented-lossy expectations into passing round-trips.
5. Confirm `serialize.ts` and all callers compile unchanged; Vitest + build green.

## Success Criteria

- [ ] `serialize`/`parseFmt` signatures + `Format` union unchanged; no caller edits needed.
- [ ] Previously-lossy YAML/XML cases now round-trip (tests updated from "documented lossy" to passing).
- [ ] JSON stays gated-lossless; text path unchanged.
- [ ] CSP gate green (libs introduce no `eval`); `npm run build` + Vitest green.

## Risk Assessment

- **CSP regression:** verify js-yaml/fast-xml-parser don't use `eval`/`Function` (they don't in default
  config) — the `npm run build` CSP assertion is the gate.
- **Subtle behavior change:** library output formatting differs from the hand-rolled one — update view
  snapshots/expectations deliberately; do not mask diffs.
- **Bundle size:** both libs are small; acceptable for a desktop app.
