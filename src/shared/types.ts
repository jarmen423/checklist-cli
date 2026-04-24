/**
 * Shared data contracts for the checklist UI, Worker API, and CLI.
 *
 * Keeping these types in one small module makes it easier for Codex and future
 * maintainers to understand the shape of the app without reverse-engineering
 * API responses from multiple files.
 */

export type ItemStatus = "active" | "finished";

export interface ChecklistItem {
  id: number;
  ledgerId: number;
  title: string;
  details: string;
  status: ItemStatus;
  sortOrder: number;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  children: ChecklistItem[];
}

export interface Ledger {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateItemRequest {
  ledgerId: number;
  title: string;
  details?: string;
  parentId?: number | null;
}

export interface UpdateItemRequest {
  title?: string;
  details?: string;
}

export interface ReorderItemsRequest {
  ledgerId: number;
  parentId?: number | null;
  orderedIds: number[];
}

export interface CreateLedgerRequest {
  name: string;
}

export interface LedgersResponse {
  ledgers: Ledger[];
}

export interface LedgerResponse {
  ledger: Ledger;
}

export interface ItemsResponse {
  items: ChecklistItem[];
}

export interface ItemResponse {
  item: ChecklistItem;
}

export interface ApiErrorResponse {
  error: string;
}
