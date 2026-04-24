import type {
  ChecklistItem,
  CreateLedgerRequest,
  CreateItemRequest,
  ItemStatus,
  Ledger,
  ReorderItemsRequest,
  UpdateItemRequest
} from "../shared/types";

interface ItemRow {
  id: number;
  ledger_id: number;
  title: string;
  details: string;
  status: ItemStatus;
  sort_order: number;
  parent_id: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface LedgerRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/**
 * Converts D1 rows into the camelCase API shape used by the UI and CLI.
 */
function rowToItem(row: ItemRow): ChecklistItem {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    title: row.title,
    details: row.details,
    status: row.status,
    sortOrder: row.sort_order,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    children: []
  };
}

function rowToLedger(row: LedgerRow): Ledger {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

/**
 * Builds a one-level checklist tree from flat D1 rows.
 *
 * The schema permits `parent_id`, but v1 deliberately supports only one child
 * level. This helper keeps the API response ergonomic without requiring the UI
 * or CLI to group child rows themselves.
 */
export function nestItems(rows: ItemRow[]): ChecklistItem[] {
  const byId = new Map<number, ChecklistItem>();
  const roots: ChecklistItem[] = [];

  for (const row of rows) {
    byId.set(row.id, rowToItem(row));
  }

  for (const item of byId.values()) {
    if (item.parentId === null) {
      roots.push(item);
      continue;
    }

    const parent = byId.get(item.parentId);
    if (parent) {
      parent.children.push(item);
    }
  }

  const bySort = (a: ChecklistItem, b: ChecklistItem) => a.sortOrder - b.sortOrder;
  roots.sort(bySort);
  for (const item of roots) {
    item.children.sort(bySort);
  }

  return roots;
}

/**
 * Encapsulates all D1 checklist persistence.
 *
 * The Worker routes stay thin and product-oriented while this repository owns
 * database details such as sort_order allocation, one-level child validation,
 * and finished-item timestamps.
 */
export class ChecklistRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Returns all ledgers in creation order.
   *
   * Ledgers are lightweight named containers. The UI uses them as a selector,
   * while the CLI can address them by ID with `--ledger`.
   */
  async listLedgers(options: { includeArchived?: boolean } = {}): Promise<Ledger[]> {
    const archivedFilter = options.includeArchived ? "" : "WHERE archived_at IS NULL";
    const result = await this.db
      .prepare(`SELECT id, name, created_at, updated_at, archived_at FROM ledgers ${archivedFilter} ORDER BY id ASC`)
      .all<LedgerRow>();

    return (result.results ?? []).map(rowToLedger);
  }

  /**
   * Creates a new named ledger for a separate checklist.
   */
  async createLedger(input: CreateLedgerRequest): Promise<Ledger> {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Ledger name is required.");
    }

    const inserted = await this.db
      .prepare(
        `INSERT INTO ledgers (name, created_at, updated_at)
         VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name, created_at, updated_at, archived_at`
      )
      .bind(name)
      .first<LedgerRow>();

    if (!inserted) {
      throw new Error("Failed to create ledger.");
    }

    return rowToLedger(inserted);
  }

  /**
   * Hides a ledger from normal active use without deleting its checklist rows.
   *
   * Archival is the safer cleanup path for old work because the ledger can be
   * restored later. The repository keeps at least one active ledger available
   * so the UI always has a valid destination after refresh.
   */
  async archiveLedger(id: number): Promise<Ledger> {
    await this.requireActiveLedgerExists(id);
    await this.requireAnotherActiveLedger(id, "Cannot archive the only active ledger.");
    await this.db
      .prepare(
        `UPDATE ledgers
         SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(id)
      .run();

    return this.requireLedger(id, { includeArchived: true });
  }

  /**
   * Makes an archived ledger selectable again.
   */
  async restoreLedger(id: number): Promise<Ledger> {
    await this.requireLedger(id, { includeArchived: true });
    await this.db
      .prepare(
        `UPDATE ledgers
         SET archived_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(id)
      .run();

    return this.requireLedger(id);
  }

  /**
   * Permanently removes a ledger and every item contained by it.
   *
   * D1 does not have a foreign key from `items.ledger_id` in the current schema,
   * so the repository explicitly deletes item rows before deleting the ledger.
   */
  async deleteLedger(id: number): Promise<void> {
    await this.requireLedger(id, { includeArchived: true });
    await this.requireAnotherActiveLedger(id, "Cannot delete the only active ledger.");
    await this.db.batch([
      this.db.prepare("DELETE FROM items WHERE ledger_id = ?").bind(id),
      this.db.prepare("DELETE FROM ledgers WHERE id = ?").bind(id)
    ]);
  }

  /**
   * Returns the active or finished checklist as one-level nested items.
   */
  async listItems(ledgerId: number, status: ItemStatus): Promise<ChecklistItem[]> {
    await this.requireLedgerExists(ledgerId);
    const result = await this.db
      .prepare(
        `SELECT id, ledger_id, title, details, status, sort_order, parent_id, created_at, updated_at, completed_at
         FROM items
         WHERE ledger_id = ? AND status = ?
         ORDER BY parent_id IS NOT NULL, sort_order ASC, id ASC`
      )
      .bind(ledgerId, status)
      .all<ItemRow>();

    return nestItems(result.results ?? []);
  }

  /**
   * Fetches a single item with its children. Used after writes so callers get
   * stable IDs and current timestamps back immediately.
   */
  async getItem(id: number): Promise<ChecklistItem | null> {
    const flat = await this.getFlatItem(id);
    if (!flat) {
      return null;
    }

    if (flat.parent_id !== null) {
      return rowToItem(flat);
    }

    const result = await this.db
      .prepare(
        `SELECT id, ledger_id, title, details, status, sort_order, parent_id, created_at, updated_at, completed_at
         FROM items
         WHERE id = ? OR parent_id = ?
         ORDER BY parent_id IS NOT NULL, sort_order ASC, id ASC`
      )
      .bind(id, id)
      .all<ItemRow>();

    const items = nestItems(result.results ?? []);
    return items.find((item) => item.id === id) ?? null;
  }

  /**
   * Creates either a top-level item or a one-level child item.
   *
   * Child creation validates the parent so the tree never becomes deeper than
   * one nested level. This protects drag/drop and CLI output from unbounded
   * recursion in v1.
   */
  async createItem(input: CreateItemRequest): Promise<ChecklistItem> {
    await this.requireLedgerExists(input.ledgerId);
    const title = input.title.trim();
    if (!title) {
      throw new Error("Title is required.");
    }

    const details = input.details?.trim() ?? "";
    const parentId = input.parentId ?? null;

    if (parentId !== null) {
      const parent = await this.getFlatItem(parentId);
      if (!parent) {
        throw new Error(`Parent item ${parentId} does not exist.`);
      }
      if (parent.parent_id !== null) {
        throw new Error("Child items cannot have their own child items in v1.");
      }
      if (parent.status !== "active") {
        throw new Error("Cannot add child items to finished items.");
      }
      if (parent.ledger_id !== input.ledgerId) {
        throw new Error("Child items must be created in the same ledger as their parent.");
      }
    }

    const sortOrder = await this.nextSortOrder(input.ledgerId, parentId);
    const insert = await this.db
      .prepare(
        `INSERT INTO items (ledger_id, title, details, status, sort_order, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id`
      )
      .bind(input.ledgerId, title, details, sortOrder, parentId)
      .first<{ id: number }>();

    if (!insert) {
      throw new Error("Failed to create checklist item.");
    }

    const item = await this.getItem(insert.id);
    if (!item) {
      throw new Error("Created item could not be loaded.");
    }
    return item;
  }

  /**
   * Updates text fields on an item without changing status or ordering.
   */
  async updateItem(id: number, input: UpdateItemRequest): Promise<ChecklistItem> {
    const existing = await this.getFlatItem(id);
    if (!existing) {
      throw new Error(`Item ${id} does not exist.`);
    }

    const title = input.title === undefined ? existing.title : input.title.trim();
    const details = input.details === undefined ? existing.details : input.details.trim();
    if (!title) {
      throw new Error("Title is required.");
    }

    await this.db
      .prepare(
        `UPDATE items
         SET title = ?, details = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(title, details, id)
      .run();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Item ${id} could not be loaded after update.`);
    }
    return item;
  }

  /**
   * Marks an item and its direct children finished.
   *
   * Finished items are retained as a repository of completed work. They leave
   * the active view because the UI and CLI filter active and finished rows by
   * status.
   */
  async finishItem(id: number): Promise<ChecklistItem> {
    await this.requireExists(id);
    await this.db
      .prepare(
        `UPDATE items
         SET status = 'finished',
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? OR parent_id = ?`
      )
      .bind(id, id)
      .run();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Item ${id} could not be loaded after finish.`);
    }
    return item;
  }

  /**
   * Reopens a finished item and its direct children into the active checklist.
   */
  async reopenItem(id: number): Promise<ChecklistItem> {
    await this.requireExists(id);
    await this.db
      .prepare(
        `UPDATE items
         SET status = 'active',
             completed_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? OR parent_id = ?`
      )
      .bind(id, id)
      .run();

    const item = await this.getItem(id);
    if (!item) {
      throw new Error(`Item ${id} could not be loaded after reopen.`);
    }
    return item;
  }

  /**
   * Applies an explicit order to sibling items.
   *
   * The UI can send the exact drag/drop order, and the CLI computes the same
   * shape for `move --before/--after`. Only siblings under the same parent are
   * accepted so a reorder cannot accidentally reparent items.
   */
  async reorderItems(input: ReorderItemsRequest): Promise<ChecklistItem[]> {
    await this.requireLedgerExists(input.ledgerId);
    const parentId = input.parentId ?? null;
    const orderedIds = input.orderedIds;

    if (!orderedIds.length) {
      throw new Error("orderedIds must contain at least one item ID.");
    }

    const placeholders = orderedIds.map(() => "?").join(", ");
    const result = await this.db
      .prepare(
        `SELECT id, parent_id
         FROM items
         WHERE ledger_id = ? AND status = 'active' AND id IN (${placeholders})`
      )
      .bind(input.ledgerId, ...orderedIds)
      .all<{ id: number; parent_id: number | null }>();

    const found = result.results ?? [];
    const foundIds = new Set(found.map((row) => row.id));
    for (const id of orderedIds) {
      if (!foundIds.has(id)) {
        throw new Error(`Active item ${id} does not exist.`);
      }
    }

    for (const row of found) {
      if (row.parent_id !== parentId) {
        throw new Error("Reorder can only apply to items with the same parent.");
      }
    }

    await this.db.batch(
      orderedIds.map((id, index) =>
        this.db
          .prepare("UPDATE items SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .bind(index + 1, id)
      )
    );

    return this.listItems(input.ledgerId, "active");
  }

  private async nextSortOrder(ledgerId: number, parentId: number | null): Promise<number> {
    const query =
      parentId === null
        ? "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM items WHERE ledger_id = ? AND parent_id IS NULL AND status = 'active'"
        : "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM items WHERE ledger_id = ? AND parent_id = ? AND status = 'active'";

    const prepared = this.db.prepare(query);
    const result =
      parentId === null
        ? await prepared.bind(ledgerId).first<{ next_order: number }>()
        : await prepared.bind(ledgerId, parentId).first<{ next_order: number }>();

    return result?.next_order ?? 1;
  }

  private async requireExists(id: number): Promise<void> {
    const existing = await this.getFlatItem(id);
    if (!existing) {
      throw new Error(`Item ${id} does not exist.`);
    }
  }

  private async getFlatItem(id: number): Promise<ItemRow | null> {
    return this.db
      .prepare(
        `SELECT id, ledger_id, title, details, status, sort_order, parent_id, created_at, updated_at, completed_at
         FROM items
         WHERE id = ?`
      )
      .bind(id)
      .first<ItemRow>();
  }

  private async requireLedgerExists(ledgerId: number): Promise<void> {
    await this.requireActiveLedgerExists(ledgerId);
  }

  private async requireActiveLedgerExists(ledgerId: number): Promise<void> {
    await this.requireLedger(ledgerId);
  }

  private async requireLedger(
    ledgerId: number,
    options: { includeArchived?: boolean } = {}
  ): Promise<Ledger> {
    const archivedFilter = options.includeArchived ? "" : "AND archived_at IS NULL";
    const ledger = await this.db
      .prepare(
        `SELECT id, name, created_at, updated_at, archived_at
         FROM ledgers
         WHERE id = ? ${archivedFilter}`
      )
      .bind(ledgerId)
      .first<LedgerRow>();

    if (!ledger) {
      throw new Error(`Ledger ${ledgerId} does not exist.`);
    }

    return rowToLedger(ledger);
  }

  private async requireAnotherActiveLedger(ledgerId: number, message: string): Promise<void> {
    const result = await this.db
      .prepare("SELECT COUNT(*) AS count FROM ledgers WHERE archived_at IS NULL AND id != ?")
      .bind(ledgerId)
      .first<{ count: number }>();

    if ((result?.count ?? 0) === 0) {
      throw new Error(message);
    }
  }
}
