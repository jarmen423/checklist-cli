import { describe, expect, it } from "vitest";
import { nestItems } from "../src/worker/repository";

/**
 * Covers the one-level tree shape returned by the Worker API.
 *
 * D1 stores checklist rows flat. The UI and CLI depend on the repository to
 * group direct child rows under their parent while keeping both levels sorted.
 */
describe("nestItems", () => {
  it("groups child rows under sorted top-level rows", () => {
    const tree = nestItems([
      row({ id: 3, title: "child b", sort_order: 2, parent_id: 1 }),
      row({ id: 2, title: "top b", sort_order: 2, parent_id: null }),
      row({ id: 1, title: "top a", sort_order: 1, parent_id: null }),
      row({ id: 4, title: "child a", sort_order: 1, parent_id: 1 })
    ]);

    expect(tree.map((item) => item.id)).toEqual([1, 2]);
    expect(tree[0].children.map((item) => item.id)).toEqual([4, 3]);
  });

  it("drops orphaned child rows from the root response", () => {
    const tree = nestItems([
      row({ id: 10, title: "orphan", sort_order: 1, parent_id: 999 }),
      row({ id: 1, title: "top", sort_order: 1, parent_id: null })
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(1);
  });
});

function row(overrides: Partial<Parameters<typeof nestItems>[0][number]>) {
  return {
    id: 1,
    ledger_id: 1,
    title: "item",
    details: "",
    status: "active" as const,
    sort_order: 1,
    parent_id: null,
    created_at: "2026-04-23 00:00:00",
    updated_at: "2026-04-23 00:00:00",
    completed_at: null,
    ...overrides
  };
}
