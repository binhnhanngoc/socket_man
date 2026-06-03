import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { pushToast, dismiss, dismissAll, useToasts } from "./use-toasts";

afterEach(() => {
  dismissAll();
  vi.useRealTimers();
});

describe("use-toasts", () => {
  it("pushes a toast the subscriber sees", () => {
    const { result } = renderHook(() => useToasts());
    expect(result.current).toHaveLength(0);

    act(() => {
      pushToast({ kind: "success", message: "saved" });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ kind: "success", message: "saved" });
  });

  it("auto-dismisses after the ttl elapses", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());

    act(() => {
      pushToast({ kind: "info", message: "hi", ttl: 1000 });
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toHaveLength(0);
  });

  it("keeps a toast with ttl <= 0 until dismissed manually", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());

    let id = 0;
    act(() => {
      id = pushToast({ kind: "error", message: "stuck", ttl: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      dismiss(id);
    });
    expect(result.current).toHaveLength(0);
  });

  it("assigns unique ids so manual dismiss removes only the target", () => {
    const { result } = renderHook(() => useToasts());
    let a = 0;
    act(() => {
      a = pushToast({ kind: "info", message: "a", ttl: 0 });
      pushToast({ kind: "info", message: "b", ttl: 0 });
    });
    expect(result.current).toHaveLength(2);

    act(() => {
      dismiss(a);
    });
    expect(result.current.map((t) => t.message)).toEqual(["b"]);
  });
});
