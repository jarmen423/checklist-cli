#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ChecklistItem,
  CreateItemRequest,
  ItemStatus,
  Ledger,
  ReorderItemsRequest,
  UpdateItemRequest
} from "../shared/types.js";
import { moveId } from "../shared/order.js";

interface CliConfig {
  apiUrl: string;
  adminToken: string;
  defaultLedgerId?: number;
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
      await listItems(client, args);
      return;
    case "finished":
      printItems(await client.list(await resolveLedgerId(client, args), "finished"));
      return;
    case "ledgers":
      printLedgers(await client.ledgers({ includeArchived: args.flags.has("all") || args.flags.has("archived") }));
      return;
    case "ledger":
      await handleLedgerCommand(client, args);
      return;
    case "find":
    case "search":
      await findItems(client, args);
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
  const defaultLedgerId = parseOptionalPositiveInt(process.env.CHECKLIST_LEDGER_ID ?? fileConfig.defaultLedgerId);

  if (!apiUrl || !adminToken) {
    throw new Error(
      "Set CHECKLIST_API_URL and CHECKLIST_ADMIN_TOKEN, or create ~/.checklist-ledger.json."
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    adminToken,
    defaultLedgerId
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
  constructor(public readonly config: CliConfig) {}

  async list(ledgerId: number, status: ItemStatus): Promise<ChecklistItem[]> {
    return this.request<{ items: ChecklistItem[] }>(`/api/items?ledgerId=${ledgerId}&status=${status}`).then(
      (body) => body.items
    );
  }

  async ledgers(options: { includeArchived?: boolean } = {}): Promise<Ledger[]> {
    const query = options.includeArchived ? "?includeArchived=true" : "";
    return this.request<{ ledgers: Ledger[] }>(`/api/ledgers${query}`).then((body) => body.ledgers);
  }

  async createLedger(name: string): Promise<Ledger> {
    return this.request<{ ledger: Ledger }>("/api/ledgers", {
      method: "POST",
      body: JSON.stringify({ name })
    }).then((body) => body.ledger);
  }

  async archiveLedger(id: number): Promise<Ledger> {
    return this.request<{ ledger: Ledger }>(`/api/ledgers/${id}/archive`, {
      method: "POST"
    }).then((body) => body.ledger);
  }

  async restoreLedger(id: number): Promise<Ledger> {
    return this.request<{ ledger: Ledger }>(`/api/ledgers/${id}/restore`, {
      method: "POST"
    }).then((body) => body.ledger);
  }

  async deleteLedger(id: number): Promise<void> {
    await this.request<{ ok: true }>(`/api/ledgers/${id}`, {
      method: "DELETE"
    });
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
    ledgerId: await resolveLedgerId(client, args),
    title,
    details: getStringFlag(args, "details") ?? ""
  });
  printItem(item);
}

async function addChild(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const ledgerId = await resolveLedgerId(client, args);
  const parentId = await resolveItemRef(client, ledgerId, args.positional[0], "parent item");
  const title = args.positional.slice(1).join(" ").trim();
  if (!title) {
    throw new Error('Usage: checklist child <item-id> "Child title"');
  }

  const item = await client.create({ ledgerId, title, parentId });
  printItem(item);
}

async function showDetails(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const ledgerId = await resolveLedgerId(client, args);
  const id = await resolveItemRef(client, ledgerId, resolvePrimaryItemRef(args), "item");
  const allItems = [...(await client.list(ledgerId, "active")), ...(await client.list(ledgerId, "finished"))];
  const item = findItem(allItems, id);
  if (!item) {
    throw new Error(`Item ${id} was not found.`);
  }
  printItem(item, { includeDetails: true, includeChildren: true });
}

async function updateItem(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const ledgerId = await resolveLedgerId(client, args);
  const id = await resolveItemRef(client, ledgerId, resolvePrimaryItemRef(args), "item");
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
  const ledgerId = await resolveLedgerId(client, args);
  const id = await resolveItemRef(client, ledgerId, resolvePrimaryItemRef(args), "item");
  const item = action === "finish" ? await client.finish(id) : await client.reopen(id);
  printItem(item);
}

async function moveItem(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const ledgerId = await resolveLedgerId(client, args);
  const id = await resolveItemRef(client, ledgerId, resolvePrimaryItemRef(args), "item");
  const before = getStringFlag(args, "before");
  const after = getStringFlag(args, "after");

  if ((before && after) || (!before && !after)) {
    throw new Error("Usage: checklist move <item-id> --before <other-id> OR --after <other-id>");
  }

  const active = await client.list(ledgerId, "active");
  const orderedIds = active.map((item) => item.id);
  const targetId = await resolveItemRef(client, ledgerId, before ?? after, "target item");
  const nextOrder = moveId(orderedIds, id, targetId, before ? "before" : "after");
  printItems(await client.reorder({ ledgerId, parentId: null, orderedIds: nextOrder }));
}

async function listItems(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const ledgerId = await resolveLedgerId(client, args);
  const active = await client.list(ledgerId, "active");
  const { includeDetails, range } = parseListOptions(args);
  const selected = range ? active.slice(range.start - 1, range.end) : active;
  printItems(selected, { includeDetails, includeChildren: includeDetails });
}

async function findItems(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const query = args.positional.join(" ").trim();
  if (!query) {
    throw new Error('Usage: checklist find "search text" [--ledger <id-or-name>]');
  }

  const ledgerId = await resolveLedgerId(client, args);
  const allItems = [...(await client.list(ledgerId, "active")), ...(await client.list(ledgerId, "finished"))];
  const matches = flattenItems(allItems).filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));
  printItems(matches);
}

async function handleLedgerCommand(client: ChecklistCliClient, args: ParsedArgs): Promise<void> {
  const [subcommand, ...nameParts] = args.positional;
  if (subcommand === "add") {
    const name = nameParts.join(" ").trim();
    if (!name) {
      throw new Error('Usage: checklist ledger add "Ledger name"');
    }
    printLedger(await client.createLedger(name));
    return;
  }

  if (subcommand === "archive") {
    const id = await resolveLedgerRef(client, nameParts.join(" ").trim(), { includeArchived: false });
    printLedger(await client.archiveLedger(id));
    return;
  }

  if (subcommand === "restore") {
    const id = await resolveLedgerRef(client, nameParts.join(" ").trim(), { includeArchived: true });
    printLedger(await client.restoreLedger(id));
    return;
  }

  if (subcommand === "delete") {
    const id = await resolveLedgerRef(client, nameParts.join(" ").trim(), { includeArchived: true });
    if (!args.flags.has("yes")) {
      throw new Error("Ledger delete is permanent. Retry with --yes to delete the ledger and all of its items.");
    }
    await client.deleteLedger(id);
    console.log(`Deleted ledger #${id}.`);
    return;
  }

  throw new Error('Usage: checklist ledger add|archive|restore|delete "Ledger name or id"');
}

async function resolveLedgerId(client: ChecklistCliClient, args: ParsedArgs): Promise<number> {
  const ledgerRef = getStringFlag(args, "ledger");
  if (!ledgerRef) {
    return client.config.defaultLedgerId ?? 1;
  }

  const numeric = parseOptionalPositiveInt(ledgerRef);
  if (numeric !== undefined) {
    return numeric;
  }

  const ledgers = await client.ledgers();
  const matches = ledgers.filter((ledger) => ledger.name.toLowerCase() === ledgerRef.toLowerCase());
  if (matches.length === 1) {
    return matches[0].id;
  }
  if (matches.length > 1) {
    throw new Error(`Ledger name "${ledgerRef}" matched multiple ledgers. Use one of these IDs: ${matches.map((ledger) => ledger.id).join(", ")}`);
  }
  throw new Error(`Ledger "${ledgerRef}" was not found. Run checklist ledgers to see available ledgers.`);
}

async function resolveLedgerRef(
  client: ChecklistCliClient,
  ref: string,
  options: { includeArchived: boolean }
): Promise<number> {
  if (!ref) {
    throw new Error("Expected ledger ID or exact ledger name.");
  }

  const numeric = parseOptionalPositiveInt(ref);
  if (numeric !== undefined) {
    return numeric;
  }

  const ledgers = await client.ledgers({ includeArchived: options.includeArchived });
  const matches = ledgers.filter((ledger) => ledger.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) {
    return matches[0].id;
  }
  if (matches.length > 1) {
    throw new Error(`Ledger name "${ref}" matched multiple ledgers. Use one of these IDs: ${matches.map((ledger) => ledger.id).join(", ")}`);
  }
  throw new Error(`Ledger "${ref}" was not found.`);
}

function parseOptionalPositiveInt(value: string | number | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number(value.replace(/^#/, ""));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

async function resolveItemRef(
  client: ChecklistCliClient,
  ledgerId: number,
  ref: string | undefined,
  label: string
): Promise<number> {
  if (!ref) {
    throw new Error(`Expected ${label} ID or unique title text.`);
  }

  const numeric = parseOptionalPositiveInt(ref);
  if (numeric !== undefined) {
    return numeric;
  }

  const allItems = [...(await client.list(ledgerId, "active")), ...(await client.list(ledgerId, "finished"))];
  const matches = flattenItems(allItems).filter((item) => item.title.toLowerCase().includes(ref.toLowerCase()));
  if (matches.length === 1) {
    return matches[0].id;
  }
  if (matches.length > 1) {
    throw new Error(`"${ref}" matched multiple items: ${matches.map((item) => `#${item.id} ${item.title}`).join("; ")}`);
  }
  throw new Error(`No ${label} matched "${ref}". Run checklist find "${ref}" to inspect matches.`);
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

function flattenItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.flatMap((item) => [item, ...item.children]);
}

function getStringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function resolvePrimaryItemRef(args: ParsedArgs): string | undefined {
  return getStringFlag(args, "item") ?? args.positional[0];
}

function parseListOptions(args: ParsedArgs): {
  includeDetails: boolean;
  range: { start: number; end: number } | null;
} {
  let includeDetails = false;
  let range: { start: number; end: number } | null = null;

  for (const value of args.positional) {
    if (value.toLowerCase() === "full") {
      includeDetails = true;
      continue;
    }

    const parsedRange = parseRange(value);
    if (parsedRange) {
      range = parsedRange;
      continue;
    }

    throw new Error(`Unknown list argument "${value}". Use: checklist list [full] [1-4] --ledger <id-or-name>`);
  }

  return { includeDetails, range };
}

function parseRange(value: string): { start: number; end: number } | null {
  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    throw new Error(`Invalid list range "${value}". Use a 1-based range like 1-4.`);
  }

  return { start, end };
}

function printItems(
  items: ChecklistItem[],
  options: { includeDetails?: boolean; includeChildren?: boolean } = {}
): void {
  if (items.length === 0) {
    console.log("No items.");
    return;
  }

  for (const item of items) {
    printItem(item, options);
    if (!options.includeChildren) {
      for (const child of item.children) {
        console.log(`  - #${child.id} ${child.title}`);
      }
    }
  }
}

function printItem(
  item: ChecklistItem,
  options: { includeDetails?: boolean; includeChildren?: boolean } = {}
): void {
  const status = item.status === "finished" ? "done" : "active";
  console.log(`#${item.id} [${status}] ledger:${item.ledgerId} ${item.title}`);
  if (options.includeDetails) {
    console.log(`  details: ${item.details || "(none)"}`);
    console.log(`  created: ${item.createdAt}`);
    console.log(`  updated: ${item.updatedAt}`);
    if (item.completedAt) {
      console.log(`  completed: ${item.completedAt}`);
    }
  }
  if (options.includeChildren) {
    if (item.children.length === 0) {
      console.log("  subitems: (none)");
      return;
    }
    console.log("  subitems:");
    for (const child of item.children) {
      const childStatus = child.status === "finished" ? "done" : "active";
      console.log(`    #${child.id} [${childStatus}] ${child.title}`);
      if (options.includeDetails) {
        console.log(`      details: ${child.details || "(none)"}`);
      }
    }
  }
}

function printLedgers(ledgers: Ledger[]): void {
  if (ledgers.length === 0) {
    console.log("No ledgers.");
    return;
  }
  for (const ledger of ledgers) {
    printLedger(ledger);
  }
}

function printLedger(ledger: Ledger): void {
  const state = ledger.archivedAt ? "archived" : "active";
  console.log(`#${ledger.id} [${state}] ${ledger.name}`);
}

function printHelp(): void {
  console.log(`Checklist Ledger CLI

Commands:
  checklist list
  checklist list full
  checklist list 1-4
  checklist list full 1-4
  checklist finished
  checklist ledgers
  checklist ledgers --all
  checklist ledger add "Ledger name"
  checklist ledger archive <ledger-id-or-name>
  checklist ledger restore <ledger-id-or-name>
  checklist ledger delete <ledger-id-or-name> --yes
  checklist find "search text"
  checklist add "Title" --details "Optional details"
  checklist child <item-id-or-title> "Child title"
  checklist details <item-id-or-title>
  checklist details --item <item-id-or-title>
  checklist update <item-id-or-title> --title "..." --details "..."
  checklist update --item <item-id-or-title> --title "..." --details "..."
  checklist done <item-id-or-title>
  checklist done --item <item-id-or-title>
  checklist reopen <item-id-or-title>
  checklist move <item-id-or-title> --before <other-id-or-title>
  checklist move --item <item-id-or-title> --after <other-id-or-title>

Ledger selection:
  Add --ledger <id-or-name> to list, finished, add, child, details, update, done, reopen, find, or move.
  Set CHECKLIST_LEDGER_ID to change the default ledger from 1.

Config:
  CHECKLIST_API_URL=https://your-domain.example
  CHECKLIST_ADMIN_TOKEN=your-admin-token
  CHECKLIST_LEDGER_ID=1

Optional file:
  ~/.checklist-ledger.json with {"apiUrl":"...","adminToken":"...","defaultLedgerId":1}
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
