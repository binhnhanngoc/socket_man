---
phase: 3
title: "Search Filter & Virtualization"
status: complete
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 3: Search Filter & Virtualization

## Overview

Make the WS frame log usable at scale: a filter bar (by direction + text match) and windowed rendering so
very large logs stay smooth. Pure frontend; preserves the existing sticky-to-bottom behavior and the
unified/split layouts.

## Requirements

- **Functional:** filter the frame log by direction (`sent` / `received` / `system`) and a free-text match
  over the rendered body; show match count. Virtualize the scroll list so a 10k+ frame log scrolls without
  jank. Works in both unified and split (`out` vs `in/sys`) modes.
- **Non-functional:** sticky-scroll-to-bottom (current `useStickyScroll`) must keep working with
  virtualization; pause/resume + coalescing semantics unchanged; no regression to the empty-state messages.

## Architecture

<!-- Updated: Validation Session 1 - windowing lib locked to @tanstack/react-virtual (hand-rolled rejected) -->
- Add `@tanstack/react-virtual` (framework-agnostic, small) — confirm it adds no CSP `eval`. Use its
  dynamic row-measurement API (not a fixed estimate) so `dense`-mode variable heights align correctly.
- `log-stream.tsx`: replace the direct `.map()` renders with a virtualized list per scroll container. The
  filter is applied to `frames` BEFORE windowing. Keep `useStickyScroll` but drive it off the virtualizer's
  scroll element + total size.
- New `src/components/log-filter-bar.tsx`: direction toggles + text input + count; lifts filter state to
  `ws-workspace.tsx` (or a small `use-log-filter` hook) so split mode shares one filter.
- `log-row.tsx` unchanged (row renderer reused by the virtualizer).

## Related Code Files

- Create: `src/components/log-filter-bar.tsx`, optional `src/hooks/use-log-filter.ts`,
  `src/components/log-stream.test.tsx`
- Modify: `src/components/log-stream.tsx`, `src/components/ws-workspace.tsx`, `package.json`
- Read for context: `src/components/log-row.tsx`, `src/components/ws-tab-panes.tsx`

## Implementation Steps

1. Add the windowing dep; verify `npm run build` CSP gate stays green.
2. Add filter state (direction set + text) in `ws-workspace` or `use-log-filter`; render `log-filter-bar`.
3. Apply filter to `frames`; pass filtered list to `log-stream`.
4. Virtualize each `log-scroll` container; re-implement sticky-to-bottom against the virtualizer.
5. Preserve split-mode partition (`out` vs `in/sys`) over the filtered list; keep empty states + counts.
6. Vitest: filter narrows correctly (dir + text); sticky-scroll logic unit-tested; large-list smoke render.

## Success Criteria

- [ ] 10k+ frame log scrolls smoothly (virtualized; DOM node count bounded).
- [ ] Filter by direction + text narrows correctly in unified AND split modes; count shown.
- [ ] Sticky-to-bottom still auto-follows new frames unless scrolled up; pause/coalesce unaffected.
- [ ] `npm run build` (incl. CSP gate) + Vitest green.

## Risk Assessment

- **Sticky-scroll vs virtualization** is the main hazard — the current `scrollHeight` math must move to the
  virtualizer's measured total size; test explicitly.
- **Variable row height** under `dense` — use the virtualizer's measurement API, not a fixed estimate, or
  rows will misalign.
- **Filter + export interaction (Phase 2):** export should serialize the filtered/visible set — confirm the
  contract once both land.
