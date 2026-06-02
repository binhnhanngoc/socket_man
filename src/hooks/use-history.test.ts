import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useHistory } from "./use-history";
import { appendHistory } from "../lib/history-log";

// Drives the real mock transport (localStorage-backed history shim).
describe("useHistory", () => {
  beforeEach(() => localStorage.clear());

  it("reads appended entries newest-first when opened, and clears them", async () => {
    appendHistory({ kind: "http", itemId: "h1", label: "GET /a", summary: "200" });
    appendHistory({ kind: "ws", itemId: "w1", label: "wss://x", summary: "session ended" });

    const { result, rerender } = renderHook(({ open }) => useHistory(open), {
      initialProps: { open: false },
    });
    // Opening triggers a read.
    rerender({ open: true });

    await waitFor(() => expect(result.current.entries.length).toBe(2));
    // Newest-first: the WS entry was appended last → index 0.
    expect(result.current.entries[0].kind).toBe("ws");

    await act(async () => {
      result.current.clear();
    });
    await waitFor(() => expect(result.current.entries.length).toBe(0));
  });

  it("never persists a resolved secret — only the template the caller passed", async () => {
    appendHistory({ kind: "http", itemId: "h1", label: "GET {{base}}", summary: "200", payload: { headers: [{ k: "Authorization", v: "Bearer {{token}}" }] } });
    const raw = localStorage.getItem("socketman.store.history") || "";
    expect(raw).toContain("{{token}}");
    expect(raw).not.toContain("atk_live");
  });
});
