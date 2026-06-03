import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transport } from "../transport";
import { mockTransport } from "../transport/mock-transport";
import type { Frame } from "../transport/transport";

const { pushToast } = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock("../hooks/use-toasts", () => ({ pushToast }));

import { copyText, saveText, saveFrameLog, framesToJson, framesToText } from "./export-file";

// An out-frame whose body carries a secret TEMPLATE (never a resolved value).
const secretFrame: Frame = {
  id: 1,
  dir: "out",
  kind: "auth",
  ts: 1_700_000_000_000,
  size: 24,
  body: { action: "auth", header: "Bearer {{token}}" },
};

beforeEach(() => pushToast.mockClear());
afterEach(() => vi.restoreAllMocks());

describe("frame serializers", () => {
  it("framesToJson keeps secret templates literal and stays parseable", () => {
    const json = framesToJson([secretFrame]);
    expect(json).toContain("{{token}}");
    expect(json).not.toMatch(/atk_live|Bearer [A-Za-z0-9._-]{8,}/);
    const parsed = JSON.parse(json);
    expect(parsed[0]).toMatchObject({ dir: "out", kind: "auth", size: 24 });
  });

  it("framesToText renders a readable line and keeps the template", () => {
    const txt = framesToText([secretFrame]);
    expect(txt).toContain("SENT");
    expect(txt).toContain("auth");
    expect(txt).toContain("{{token}}");
  });
});

describe("saveFrameLog", () => {
  it("serializes JSON or TXT by chosen extension and toasts success", async () => {
    const spy = vi.spyOn(transport, "exportSave").mockImplementation(async (_name, _filters, contentFor) => {
      // Both formats must preserve the template.
      expect(contentFor("json")).toContain("{{token}}");
      expect(contentFor("txt")).toContain("SENT");
      return "C:/Users/me/frame-log.json";
    });
    await saveFrameLog([secretFrame]);
    expect(spy).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });

  it("stays silent when the user cancels the dialog", async () => {
    vi.spyOn(transport, "exportSave").mockResolvedValue(null);
    await saveFrameLog([secretFrame]);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("toasts an error if the write throws", async () => {
    vi.spyOn(transport, "exportSave").mockRejectedValue(new Error("disk full"));
    await saveFrameLog([secretFrame]);
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
  });
});

describe("saveText", () => {
  it("passes the contents through unchanged and reports the saved name", async () => {
    vi.spyOn(transport, "exportSave").mockImplementation(async (_name, _filters, contentFor) => {
      expect(contentFor("txt")).toBe("hello body");
      return "/home/me/response.txt";
    });
    await saveText("response.txt", "hello body");
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "success", message: expect.stringContaining("response.txt") }));
  });
});

describe("copyText", () => {
  it("writes via the Clipboard API and toasts success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await copyText("snippet");
    expect(writeText).toHaveBeenCalledWith("snippet");
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }));
  });
});

describe("mock transport exportSave (hermetic Blob fallback)", () => {
  it("derives the format from the extension and returns the suggested name", async () => {
    const r = await mockTransport.exportSave("frame-log.txt", [], (ext) => (ext === "txt" ? "T" : "J"));
    expect(r).toBe("frame-log.txt");
  });
});
