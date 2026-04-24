#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ChecklistItem,
  CreateItemRequest,
  ItemStatus,
  ReorderItemsRequest,
  UpdateItemRequest
} from "../shared/types.js";
import { moveId } from "../shared/order.js";

interface CliConfig {
  apiUrl: string;
  adminToken: string;
}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

/**
 * Command-line control layer for the hosted checklist.
 *
 * Codex should use this CLI instead of editing D1 directly. The CLI keeps
 * mutation semantics centralized in the Worker API, returns stable item IDs,
 * and can target the deployed app from any workspace with the right token.
 */
async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const config = loadConfig();
  const client = new ChecklistCliClient(config);
  const args = parseArgs(rest);

  switch (command) {
    case "list":
      printItems(await client.list("active"));
      return;
    case "finished":
      printItems(await client.list("finished"));
      return;
    case "add":
      await addItem(client, args);
      return;
    case "child":
      await addChild(client, args);
      return;
    case "details":
      await showDetails(client, args);
      return;
    case "update":
      await updateItem(client, args);
      return;
    case "done":
      await changeStatus(client, args, "finish");
      return;
    case "reopen":
      await changeStatus(client, args, "reopen");
      return;
    case "move":
      await moveItem(client, args);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Loads CLI configuration from environment first, then a small home-directory
 * JSON file. Environment variables are easiest for Codex automation; the file
 * is convenient for a human shell.
 */
function loadConfig(): CliConfig {
  const fileConfig = loadFileConfig();
  const apiUrl = process.env.CHECKLIST_API_URL ?? fileConfig.apiUrl;
  const adminToken = process.env.CHECKLIST_ADMIN_TOKEN ?? fileConfig.adminToken;

  if (!apiUrl || !adminToken) {
    throw new Error(
      "Set CHECKLIST_API_URL and CHECKLIST_ADMIN_TOKEN, or create ~/.checklist-ledger.json."
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    adminToken
  };
}

function loadFileConfig(): Partial<CliConfig> {
  const path = join(homedir(), ".checklist-ledger.json");
  if (!existsSync(path)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
  return parsed;
}

/**
 * Minimal argument parser for the small command set.
 *
 * Values can be passed as `--flag value` or boolean flags like `--after`. The
 * parser intentionally avoids shell-specific behavior so examples work in both
 * PowerShell and common Unix shells.
 */
function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const name = arg.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { positional, flags };
}

class ChecklistCliClient {
  constructor(private readonly config: CliConfig) {}

  async list(status: ItemStatus): Promise<ChecklistItem[]> {
    return this.request<{ items: ChecklistItem[] }>(`/api/items?status=${status}`).then(
      (body) => body.items
    );
  }

  async create(input: CreateItemRequest): Promise<ChecklistItem> {
    return this.request<{ item: ChecklistItem }>("/api/items", {
      method: "POST",
      body: JSON.stringify(input)
    }).then((body) => body.item);
  }

  async update(id: number, input: UpdateItemRequest): Promise<ChecklistItem> {
    return this.request<{ item: ChecklistItem }>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }).then((body) => body.item);
  }

  async finish(id: number): Promise<ChecklistItem> {
    return this.request<{ item: ChecklistItem }>(`/api/items/${id}/finish`, {
      method: "POST"
    }).then((body) => body.item);
  }

  async reopen(id: number): Promise<ChecklistItem> {
    return this.request<{ item: ChecklistItem }>(`/api/items/${id}/reopen`, {
      method: "POST"
    }).then((body) => body.item);
  }

  async reorder(input: ReorderItemsRequest): Promise<ChecklistItem[]> {
    return this.request<{ items: ChecklistItem[] }>("/api/items/reorder", {
      method: "POST",
      body: JSON.stringify(input)
    }).then((body) => body.items);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.adminToken}`,
        ...init.headers
      }
    });

    const body = (await response.json()) as T | { error?: string };
    if (!response.ok) {
      throw new Error(readErrorMessage(body) ?? `Request failed: ${response.status}`);
    }

    return body as T;
  }
}

function readErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return null;
  }

  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

async function addItem(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const title = args.positional.join(" ").trim();
  if (!title) {
    throw new Error('Usage: checklist add "Title" --details "Optional details"');
  }

  const item = await client.create({
    title,
    details: getStringFlag(args, "details") ?? ""
  });
  printItem(item);
}

async function addChild(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const parentId = parseRequiredId(args.positional[0], "parent item ID");
  const title = args.positional.slice(1).join(" ").trim();
  if (!title) {
    throw new Error('Usage: checklist child <item-id> "Child title"');
  }

  const item = await client.create({ title, parentId });
  printItem(item);
}

async function showDetails(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const id = parseRequiredId(args.positional[0], "item ID");
  const allItems = [...(await client.list("active")), ...(await client.list("finished"))];
  const item = findItem(allItems, id);
  if (!item) {
    throw new Error(`Item ${id} was not found.`);
  }
  printItem(item, { includeDetails: true });
}

async function updateItem(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const id = parseRequiredId(args.positional[0], "item ID");
  const input: UpdateItemRequest = {};

  const title = getStringFlag(args, "title");
  const details = getStringFlag(args, "details");
  if (title !== undefined) {
    input.title = title;
  }
  if (details !== undefined) {
    input.details = details;
  }
  if (input.title === undefined && input.details === undefined) {
    throw new Error('Usage: checklist update <item-id> --title "..." --details "..."');
  }

  printItem(await client.update(id, input), { includeDetails: true });
}

async function changeStatus(
  client: ChecklistCliClient,
  args: ParsedArgs,
  action: "finish" | "reopen"
): Promise<void> {
  const id = parseRequiredId(args.positional[0], "item ID");
  const item = action === "finish" ? await client.finish(id) : await client.reopen(id);
  printItem(item);
}

async function moveItem(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const id = parseRequiredId(args.positional[0], "item ID");
  const before = getStringFlag(args, "before");
  const after = getStringFlag(args, "after");

  if ((before && after) || (!before && !after)) {
    throw new Error("Usage: checklist move <item-id> --before <other-id> OR --after <other-id>");
  }

  const active = await client.list("active");
  const orderedIds = active.map((item) => item.id);
  const targetId = parseRequiredId(before ?? after, "target item ID");
  const nextOrder = moveId(orderedIds, id, targetId, before ? "before" : "after");
  printItems(await client.reorder({ parentId: null, orderedIds: nextOrder }));
}

function findItem(items: ChecklistItem[], id: number): ChecklistItem | null {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }
    const child = item.children.find((candidate) => candidate.id === id);
    if (child) {
      return child;
    }
  }
  return null;
}

function getStringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function parseRequiredId(value: string | undefined, label: string): number {
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id <= 0) {
    throw new Error(`Expected a positive numeric ${label}.`);
  }
  return id;
}

function printItems(items: ChecklistItem[]): void {
  if (items.length === 0) {
    console.log("No items.");
    return;
  }

  for (const item of items) {
    printItem(item);
    for (const child of item.children) {
      console.log(`  - #${child.id} ${child.title}`);
    }
  }
}

function printItem(item: ChecklistItem, options: { includeDetails?: boolean } = {}): void {
  const status = item.status === "finished" ? "done" : "active";
  console.log(`#${item.id} [${status}] ${item.title}`);
  if (options.includeDetails && item.details) {
    console.log(item.details);
  }
}

function printHelp(): void {
  console.log(`Checklist Ledger CLI

Commands:
  checklist list
  checklist finished
  checklist add "Title" --details "Optional details"
  checklist child <item-id> "Child title"
  checklist details <item-id>
  checklist update <item-id> --title "..." --details "..."
  checklist done <item-id>
  checklist reopen <item-id>
  checklist move <item-id> --before <other-id>
  checklist move <item-id> --after <other-id>

Config:
  CHECKLIST_API_URL=https://your-domain.example
  CHECKLIST_ADMIN_TOKEN=your-admin-token

Optional file:
  ~/.checklist-ledger.json with {"apiUrl":"...","adminToken":"..."}
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
