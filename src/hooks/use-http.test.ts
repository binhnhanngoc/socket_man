import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHttp } from "./use-http";
import type { Environment, Item } from "../types";
import type { HttpRequest, HttpResponse, Transport } from "../transport/transport";

const env: Environment = {
  id: "env-1",
  name: "Local",
  color: "leaf",
  vars: [
    { id: "v1", key: "base_url", value: "https://api.example.io", secret: false },
    { id: "v2", key: "token", value: "atk_live_SECRET_value", secret: true },
  ],
};

const item: Item = { id: "h1", kind: "http", name: "Get", url: "{{base_url}}/get", method: "GET" };

const okResponse: HttpResponse = {
  status: 200,
  statusText: "OK",
  headers: { "content-type": "application/json" },
  body: '{"ok":true}',
  timingMs: 12,
  sizeBytes: 11,
};

/** Build a Transport whose httpSend uses the given implementation; WS methods unused. */
function fakeTransport(httpSend: Transport["httpSend"]): Transport {
  return {
    wsConnect: vi.fn(),
    wsSend: vi.fn(),
    wsDisconnect: vi.fn(),
    httpSend,
  } as unknown as Transport;
}

describe("useHttp", () => {
  it("transitions loading→success and stores the response", async () => {
    const tp = fakeTransport(vi.fn().mockResolvedValue(okResponse));
    const { result } = renderHook(() => useHttp(item, env, tp));

    expect(result.current.loading).toBe(false);
    expect(result.current.response).toBeNull();

    await act(async () => {
      await result.current.send();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.response).toEqual(okResponse);
  });

  it("transitions loading→error and clears the response", async () => {
    const tp = fakeTransport(vi.fn().mockRejectedValue(new Error("connection failed")));
    const { result } = renderHook(() => useHttp(item, env, tp));

    await act(async () => {
      await result.current.send();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.response).toBeNull();
    expect(result.current.error).toBe("connection failed");
  });

  // SECURITY-CRITICAL (F1): the request handed to the transport must carry secret
  // tokens LITERALLY — the plaintext secret value must never appear in the payload.
  it("leaves a secret {{token}} literal in url/headers/body; resolves non-secret vars", async () => {
    let captured: HttpRequest | null = null;
    const tp = fakeTransport(
      vi.fn().mockImplementation((req: HttpRequest) => {
        captured = req;
        return Promise.resolve(okResponse);
      })
    );
    const postItem: Item = { ...item, method: "POST", url: "{{base_url}}/submit?k={{token}}" };
    const { result } = renderHook(() => useHttp(postItem, env, tp));

    act(() => {
      result.current.addHeader();
    });
    const rowId = result.current.headers[0].id;
    act(() => {
      result.current.setHeaderRow(rowId, { k: "Authorization", v: "Bearer {{token}}" });
      result.current.setBody('{"secret":"{{token}}"}');
    });

    await act(async () => {
      await result.current.send();
    });

    const req = captured as unknown as HttpRequest;
    expect(req).not.toBeNull();
    // Non-secret base_url resolved; secret token stays literal everywhere.
    expect(req.url).toBe("https://api.example.io/submit?k={{token}}");
    expect(req.headers["Authorization"]).toBe("Bearer {{token}}");
    expect(req.body).toBe('{"secret":"{{token}}"}');
    // Belt-and-suspenders: the plaintext secret VALUE appears nowhere in the payload.
    const serialized = JSON.stringify(req);
    expect(serialized).not.toContain("atk_live_SECRET_value");
  });
});
