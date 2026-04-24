import type { ApiErrorResponse } from "../shared/types";
import type { Env } from "./env";

/**
 * Creates a JSON response with consistent headers.
 *
 * The API is intentionally small, so a tiny helper is clearer than pulling in
 * a routing framework. The frontend and CLI both rely on JSON errors for
 * readable failure messages.
 */
export function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers
  });
}

/**
 * Sends a stable error envelope that the CLI can print directly.
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse<ApiErrorResponse>({ error: message }, { status });
}

/**
 * Validates the shared admin token for every API request.
 *
 * V1 is a single-user app on a custom domain. The browser stores this token in
 * localStorage and the CLI sends it as a Bearer token, giving both clients one
 * safe path through the same Worker API.
 */
export function requireAuth(request: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) {
    return errorResponse("ADMIN_TOKEN is not configured for this Worker.", 500);
  }

  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  const actual = request.headers.get("authorization");
  if (actual !== expected) {
    return errorResponse("Missing or invalid checklist admin token.", 401);
  }

  return null;
}

/**
 * Reads and parses a JSON request body, returning a friendly API error if the
 * body is absent or malformed.
 */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
