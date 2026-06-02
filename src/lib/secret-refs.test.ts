import { describe, it, expect } from "vitest";
import { secretRefsFor, maskSecretTokens } from "./secret-refs";
import type { Environment } from "../types";

const env: Environment = {
  id: "env-1",
  name: "Local",
  color: "leaf",
  vars: [
    { id: "v1", key: "base_url", value: "https://api.example.io", secret: false },
    { id: "v2", key: "token", value: "atk_live_SECRET", secret: true },
    { id: "v3", key: "api_key", value: "sk_SECRET", secret: true },
    { id: "v4", key: "", value: "ignored", secret: true },
  ],
};

describe("secretRefsFor", () => {
  it("returns only the KEYS of secret vars (never values)", () => {
    const refs = secretRefsFor(env);
    expect(refs).toEqual({ envId: "env-1", secretKeys: ["token", "api_key"] });
    // No secret VALUE is present anywhere in the refs object.
    expect(JSON.stringify(refs)).not.toContain("atk_live_SECRET");
    expect(JSON.stringify(refs)).not.toContain("sk_SECRET");
  });

  it("returns undefined when there is no env or no secret vars", () => {
    expect(secretRefsFor(null)).toBeUndefined();
    expect(secretRefsFor({ ...env, vars: env.vars.filter((v) => !v.secret) })).toBeUndefined();
  });
});

describe("maskSecretTokens", () => {
  it("masks secret tokens as •••• and leaves non-secret tokens intact", () => {
    const out = maskSecretTokens("{{base_url}}/x?k={{token}}", env);
    expect(out).toBe("{{base_url}}/x?k=••••");
  });

  it("returns the string unchanged with no env", () => {
    expect(maskSecretTokens("{{token}}", null)).toBe("{{token}}");
  });
});
