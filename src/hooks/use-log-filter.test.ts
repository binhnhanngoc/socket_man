import { describe, it, expect } from "vitest";
import { applyLogFilter } from "./use-log-filter";
import type { Frame, FrameDir } from "../transport/transport";

let seq = 0;
function frame(dir: FrameDir, kind: string, body: unknown): Frame {
  return { id: ++seq, dir, kind, body, ts: 1_700_000_000_000, size: 10 };
}

const frames: Frame[] = [
  frame("out", "message", { action: "subscribe", channel: "prices" }),
  frame("in", "telemetry", { node: "alpha", priceUSDMWh: 42 }),
  frame("in", "alert", { severity: "high", bot: "scout" }),
  frame("sys", "open", { server: "echo-1" }),
];

describe("applyLogFilter", () => {
  it("returns all frames when no direction and no text", () => {
    expect(applyLogFilter(frames, new Set(), "")).toHaveLength(4);
  });

  it("narrows by a single direction", () => {
    const inOnly = applyLogFilter(frames, new Set<FrameDir>(["in"]), "");
    expect(inOnly.map((f) => f.dir)).toEqual(["in", "in"]);
  });

  it("narrows by a union of directions", () => {
    const outSys = applyLogFilter(frames, new Set<FrameDir>(["out", "sys"]), "");
    expect(outSys.map((f) => f.dir)).toEqual(["out", "sys"]);
  });

  it("matches free text case-insensitively over body and kind", () => {
    expect(applyLogFilter(frames, new Set(), "PRICES")).toHaveLength(1);
    expect(applyLogFilter(frames, new Set(), "telemetry")).toHaveLength(1);
    expect(applyLogFilter(frames, new Set(), "scout")).toHaveLength(1);
  });

  it("combines direction and text (AND)", () => {
    // "alpha" only appears in the telemetry in-frame.
    expect(applyLogFilter(frames, new Set<FrameDir>(["in"]), "alpha")).toHaveLength(1);
    // direction excludes the only text match → empty.
    expect(applyLogFilter(frames, new Set<FrameDir>(["out"]), "alpha")).toHaveLength(0);
  });

  it("returns the original array reference when inactive (cheap fast-path)", () => {
    expect(applyLogFilter(frames, new Set(), "  ")).toBe(frames);
  });
});
