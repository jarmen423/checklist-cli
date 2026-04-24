import { describe, expect, it } from "vitest";
import { moveId } from "../src/shared/order";

describe("moveId", () => {
  it("moves an item before another sibling", () => {
    expect(moveId([1, 2, 3, 4], 4, 2, "before")).toEqual([1, 4, 2, 3]);
  });

  it("moves an item after another sibling", () => {
    expect(moveId([1, 2, 3, 4], 1, 3, "after")).toEqual([2, 3, 1, 4]);
  });

  it("rejects moves for IDs outside the current sibling order", () => {
    expect(() => moveId([1, 2, 3], 9, 2, "before")).toThrow(
      "Item 9 is not in the active top-level checklist."
    );
  });
});
