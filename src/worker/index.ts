import type {
  CreateLedgerRequest,
  CreateItemRequest,
  ItemStatus,
  ReorderItemsRequest,
  UpdateItemRequest
} from "../shared/types";
import type { Env } from "./env";
import { errorResponse, jsonResponse, readJson, requireAuth } from "./http";
import { ChecklistRepository } from "./repository";

/**
 * Cloudflare Worker entrypoint.
 *
 * Requests under `/api/*` are token-protected JSON routes. Everything else is
 * delegated to the Worker static asset binding so the same deployment serves
 * both the React UI and the API.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const authError = requireAuth(request, env);
    if (authError) {
      return authError;
    }

    try {
      return await handleApiRequest(request, env, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected checklist API error.";
      return errorResponse(message, 400);
    }
  }
};

/**
 * Routes the small v1 API without a framework dependency.
 */
async function handleApiRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const repo = new ChecklistRepository(env.DB);
  const method = request.method.toUpperCase();
  const path = url.pathname;
  const itemAction = path.match(/^\/api\/items\/(\d+)\/(finish|reopen)$/);
  const itemPatch = path.match(/^\/api\/items\/(\d+)$/);
  const ledgerAction = path.match(/^\/api\/ledgers\/(\d+)\/(archive|restore)$/);
  const ledgerDelete = path.match(/^\/api\/ledgers\/(\d+)$/);

  if (method === "GET" && path === "/api/items") {
    const status = parseStatus(url.searchParams.get("status"));
    const ledgerId = parseLedgerId(url.searchParams.get("ledgerId"));
    return jsonResponse({ items: await repo.listItems(ledgerId, status) });
  }

  if (method === "GET" && path === "/api/ledgers") {
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    return jsonResponse({ ledgers: await repo.listLedgers({ includeArchived }) });
  }

  if (method === "POST" && path === "/api/ledgers") {
    const body = await readJson<CreateLedgerRequest>(request);
    return jsonResponse({ ledger: await repo.createLedger(body) }, { status: 201 });
  }

  if (method === "POST" && ledgerAction) {
    const id = Number(ledgerAction[1]);
    const action = ledgerAction[2];
    const ledger = action === "archive" ? await repo.archiveLedger(id) : await repo.restoreLedger(id);
    return jsonResponse({ ledger });
  }

  if (method === "DELETE" && ledgerDelete) {
    await repo.deleteLedger(Number(ledgerDelete[1]));
    return jsonResponse({ ok: true });
  }

  if (method === "POST" && path === "/api/items") {
    const body = await readJson<CreateItemRequest>(request);
    return jsonResponse({ item: await repo.createItem(body) }, { status: 201 });
  }

  if (method === "PATCH" && itemPatch) {
    const body = await readJson<UpdateItemRequest>(request);
    return jsonResponse({ item: await repo.updateItem(Number(itemPatch[1]), body) });
  }

  if (method === "POST" && itemAction) {
    const id = Number(itemAction[1]);
    const action = itemAction[2];
    const item = action === "finish" ? await repo.finishItem(id) : await repo.reopenItem(id);
    return jsonResponse({ item });
  }

  if (method === "POST" && path === "/api/items/reorder") {
    const body = await readJson<ReorderItemsRequest>(request);
    return jsonResponse({ items: await repo.reorderItems(body) });
  }

  return errorResponse("Checklist API route not found.", 404);
}

function parseStatus(value: string | null): ItemStatus {
  if (value === null || value === "active") {
    return "active";
  }
  if (value === "finished") {
    return "finished";
  }
  throw new Error("status must be active or finished.");
}

function parseLedgerId(value: string | null): number {
  const ledgerId = Number(value ?? "1");
  if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
    throw new Error("ledgerId must be a positive integer.");
  }
  return ledgerId;
}
