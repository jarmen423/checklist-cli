import { describe, expect, it } from "vitest";
import { requireAuth } from "../src/worker/http";
import type { Env } from "../src/worker/env";

/**
 * Tests the shared-token gate used by both the browser UI and CLI.
 *
 * The auth layer is intentionally small, but it protects every checklist API
 * route in v1, so the exact failure modes should remain stable.
 */
describe("requireAuth", () => {
  const env = { ADMIN_TOKEN: "secret" } as Env;

  it("allows a matching bearer token", () => {
    const request = new Request("https://checklist.example/api/items", {
      headers: { authorization: "Bearer secret" }
    });

    expect(requireAuth(request, env)).toBeNull();
  });

  it("rejects a missing bearer token", async () => {
    const request = new Request("https://checklist.example/api/items");
    const response = requireAuth(request, env);

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: "Missing or invalid checklist admin token."
    });
  });

  it("reports a server configuration error when ADMIN_TOKEN is absent", async () => {
    const request = new Request("https://checklist.example/api/items");
    const response = requireAuth(request, {} as Env);

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      error: "ADMIN_TOKEN is not configured for this Worker."
    });
  });
});
