import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockTransport } from "./mock-transport";
import type { ConnStatus, Frame } from "./transport";

describe("mockTransport disconnect-during-connecting (H1 regression)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cancels a pending connect: never flips to connected, emits closed, no zombie tick", async () => {
    const statuses: ConnStatus[] = [];
    const frames: Frame[] = [];
    const connId = await mockTransport.wsConnect(
      { url: "wss://x", headers: {} },
      (f) => frames.push(...f),
      (s) => statuses.push(s)
    );

    // Disconnect BEFORE the ~620ms connect delay elapses.
    vi.advanceTimersByTime(200);
    await mockTransport.wsDisconnect(connId);

    // Advance well past connect delay + several tick intervals.
    vi.advanceTimersByTime(5000);

    expect(statuses.map((s) => s.status)).toContain("connecting");
    expect(statuses.map((s) => s.status)).not.toContain("connected");
    expect(frames.some((f) => f.kind === "closed")).toBe(true);
    // No welcome/telemetry frames — the zombie socket must not have started.
    expect(frames.some((f) => f.kind === "open" || f.kind === "telemetry")).toBe(false);
  });

  it("normal connect still flips to connected and emits a welcome frame", async () => {
    const statuses: ConnStatus[] = [];
    const frames: Frame[] = [];
    await mockTransport.wsConnect(
      { url: "wss://x", headers: {} },
      (f) => frames.push(...f),
      (s) => statuses.push(s)
    );
    vi.advanceTimersByTime(700);
    expect(statuses.map((s) => s.status)).toContain("connected");
    expect(frames.some((f) => f.kind === "open")).toBe(true);
  });
});
