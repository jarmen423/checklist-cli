import type {
  ChecklistItem,
  CreateLedgerRequest,
  CreateItemRequest,
  ItemStatus,
  Ledger,
  ReorderItemsRequest,
  UpdateItemRequest
} from "../shared/types";

const TOKEN_KEY = "checklist-ledger-admin-token";

/**
 * Browser API client for the hosted checklist Worker.
 *
 * The UI keeps the admin token in localStorage so the deployed app can remain
 * single-user without introducing account flows in v1. The CLI uses the same
 * HTTP contract from a different client.
 */
export class ChecklistApi {
  constructor(private readonly token: string) {}

  async list(ledgerId: number, status: ItemStatus): Promise<ChecklistItem[]> {
    return this.request<{ items: ChecklistItem[] }>(`/api/items?ledgerId=${ledgerId}&status=${status}`).then(
      (body) => body.items
    );
  }

  async ledgers(options: { includeArchived?: boolean } = {}): Promise<Ledger[]> {
    const query = options.includeArchived ? "?includeArchived=true" : "";
    return this.request<{ ledgers: Ledger[] }>(`/api/ledgers${query}`).then((body) => body.ledgers);
  }

  async createLedger(input: CreateLedgerRequest): Promise<Ledger> {
    return this.request<{ ledger: Ledger }>("/api/ledgers", {
      method: "POST",
      body: JSON.stringify(input)
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
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
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

export function loadStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function saveStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
