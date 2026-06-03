import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LogStream } from "./log-stream";
import type { Frame } from "../transport/transport";

function makeFrames(n: number): Frame[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    dir: (i % 3 === 0 ? "out" : i % 3 === 1 ? "in" : "sys") as Frame["dir"],
    kind: "telemetry",
    body: { i },
    ts: 1_700_000_000_000 + i,
    size: 8,
  }));
}

describe("LogStream virtualization", () => {
  it("keeps the DOM bounded for a 10k-frame log (unified)", () => {
    const { container } = render(<LogStream frames={makeFrames(10_000)} dense={false} split={false} fmt="json" />);
    expect(container.querySelector(".log-scroll")).toBeTruthy();
    // The virtualizer sizes the scroll area for all 10k frames (huge height)...
    const virtual = container.querySelector(".log-virtual") as HTMLElement;
    expect(parseFloat(virtual.style.height)).toBeGreaterThan(10_000);
    // ...while only a bounded window of rows is actually mounted (here jsdom has no
    // viewport, so 0 are in view — the point is it is nowhere near 10k).
    expect(container.querySelectorAll(".log-row").length).toBeLessThan(200);
  });

  it("renders both scroll columns in split mode", () => {
    const { container } = render(<LogStream frames={makeFrames(300)} dense split fmt="json" />);
    expect(container.querySelectorAll(".log-scroll")).toHaveLength(2);
    expect(container.querySelectorAll(".log-col")).toHaveLength(2);
  });

  it("shows the per-column empty hint when a split side has no frames", () => {
    const allOut: Frame[] = makeFrames(3).map((f) => ({ ...f, dir: "out" }));
    const { getByText } = render(<LogStream frames={allOut} dense={false} split fmt="json" />);
    expect(getByText("Waiting for server frames…")).toBeTruthy();
  });
});
