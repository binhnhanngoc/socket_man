import { describe, it, expect } from "vitest";
import { toCurl, toFetch, toWscat, generateHttp, generateWs } from "./index";

describe("toCurl", () => {
  it("reproduces method, url, headers and body", () => {
    const out = toCurl({
      method: "post",
      url: "https://api.example.com/v1/run",
      headers: { "Content-Type": "application/json", "X-Trace": "abc" },
      body: '{"a":1}',
    });
    expect(out).toContain("curl -X POST 'https://api.example.com/v1/run'");
    expect(out).toContain("-H 'Content-Type: application/json'");
    expect(out).toContain("-H 'X-Trace: abc'");
    expect(out).toContain("--data '{\"a\":1}'");
  });

  it("keeps secret tokens literal — never a resolved value", () => {
    const out = toCurl({
      method: "GET",
      url: "https://api.example.com",
      headers: { Authorization: "Bearer {{token}}" },
    });
    expect(out).toContain("Bearer {{token}}");
    expect(out).not.toMatch(/atk_live/);
  });

  it("escapes single quotes, spaces and newlines (POSIX)", () => {
    const out = toCurl({
      method: "POST",
      url: "https://x.test/a b",
      headers: {},
      body: "line1\no'clock",
    });
    // space stays inside the quotes; embedded ' becomes '\''
    expect(out).toContain("'https://x.test/a b'");
    expect(out).toContain(`'line1\no'\\''clock'`);
  });

  it("omits --data when there is no body", () => {
    const out = toCurl({ method: "GET", url: "https://x.test", headers: {} });
    expect(out).not.toContain("--data");
  });
});

describe("toFetch", () => {
  it("emits valid fetch() with method, headers and body", () => {
    const out = toFetch({
      method: "put",
      url: "https://api.example.com/x",
      headers: { "Content-Type": "application/json" },
      body: '{"k":"v"}',
    });
    expect(out).toContain('fetch("https://api.example.com/x", {');
    expect(out).toContain('method: "PUT"');
    expect(out).toContain('"Content-Type": "application/json"');
    expect(out).toContain('body: "{\\"k\\":\\"v\\"}"');
  });

  it("keeps secret tokens literal and JS-escapes special chars", () => {
    const out = toFetch({
      method: "GET",
      url: "https://x.test",
      headers: { Authorization: "Bearer {{token}}", "X-Multi": 'a"b\nc' },
    });
    expect(out).toContain('"Authorization": "Bearer {{token}}"');
    expect(out).not.toMatch(/atk_live/);
    // JSON.stringify escapes the quote and newline.
    expect(out).toContain('"X-Multi": "a\\"b\\nc"');
  });

  it("omits headers/body keys when empty", () => {
    const out = toFetch({ method: "GET", url: "https://x.test", headers: {} });
    expect(out).not.toContain("headers");
    expect(out).not.toContain("body");
  });
});

describe("toWscat", () => {
  it("builds wscat -c with one -H per header, secrets literal", () => {
    const out = toWscat({
      url: "wss://stream.example.com/ws",
      headers: { Authorization: "Bearer {{token}}", "X-Env": "prod" },
    });
    expect(out).toContain("wscat -c 'wss://stream.example.com/ws'");
    expect(out).toContain("-H 'Authorization: Bearer {{token}}'");
    expect(out).toContain("-H 'X-Env: prod'");
    expect(out).not.toMatch(/atk_live/);
  });
});

describe("dispatch", () => {
  it("generateHttp routes curl vs fetch", () => {
    const req = { method: "GET", url: "https://x.test", headers: {} };
    expect(generateHttp("curl", req).startsWith("curl")).toBe(true);
    expect(generateHttp("fetch", req).startsWith("fetch(")).toBe(true);
  });

  it("generateWs routes wscat", () => {
    expect(generateWs("wscat", { url: "wss://x.test", headers: {} }).startsWith("wscat")).toBe(true);
  });
});
