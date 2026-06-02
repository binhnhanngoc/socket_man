import { describe, it, expect } from "vitest";
import { resolveEnv } from "../lib/resolve-env";
import type { Environment } from "../types";

const env: Environment = {
  id: "env-prod",
  name: "Production",
  color: "leaf",
  vars: [
    { id: "ev1", key: "ws_url", value: "wss://relay.example.io/v3", secret: false },
    { id: "ev2", key: "base_url", value: "https://api.example.io/v3", secret: false },
    { id: "ev3", key: "token", value: "atk_live_8f2a4d91c0", secret: true },
  ],
};

describe("resolveEnv", () => {
  it("resolves a non-secret token", () => {
    expect(resolveEnv("{{ws_url}}/x", env)).toBe("wss://relay.example.io/v3/x");
  });

  it("leaves an unknown token verbatim", () => {
    expect(resolveEnv("{{nope}}/x", env)).toBe("{{nope}}/x");
  });

  it("returns the input unchanged when env is null", () => {
    expect(resolveEnv("{{ws_url}}/x", null)).toBe("{{ws_url}}/x");
  });

  it("returns the input unchanged when env is undefined", () => {
    expect(resolveEnv("{{ws_url}}/x", undefined)).toBe("{{ws_url}}/x");
  });

  it("tolerates inner whitespace in tokens", () => {
    expect(resolveEnv("{{  ws_url  }}/x", env)).toBe("wss://relay.example.io/v3/x");
  });

  // --- SECURITY-CRITICAL (F1) -------------------------------------------------
  it("WITHOUT skipSecret resolves secret vars (legacy/preview behavior)", () => {
    expect(resolveEnv("Bearer {{token}}", env)).toBe("Bearer atk_live_8f2a4d91c0");
  });

  it("WITH skipSecret leaves a secret token LITERAL (never enters JS heap)", () => {
    const out = resolveEnv("Bearer {{token}}", env, { skipSecret: true });
    expect(out).toBe("Bearer {{token}}");
    // Belt-and-suspenders: the resolved secret VALUE must not appear at all.
    expect(out).not.toContain("atk_live_8f2a4d91c0");
    expect(out).toContain("{{token}}");
  });

  it("WITH skipSecret still resolves NON-secret tokens in the same string", () => {
    const out = resolveEnv("{{ws_url}}?auth={{token}}", env, { skipSecret: true });
    expect(out).toBe("wss://relay.example.io/v3?auth={{token}}");
  });
});
