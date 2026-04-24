/**
 * Moves one ID before or after another ID inside an existing sibling order.
 *
 * The CLI uses this to translate `move --before/--after` into the same
 * explicit `orderedIds` payload that the UI sends after drag/drop.
 */
export function moveId(
  orderedIds: number[],
  movedId: number,
  targetId: number,
  placement: "before" | "after"
): number[] {
  const fromIndex = orderedIds.indexOf(movedId);
  const targetIndex = orderedIds.indexOf(targetId);

  if (fromIndex === -1) {
    throw new Error(`Item ${movedId} is not in the active top-level checklist.`);
  }
  if (targetIndex === -1) {
    throw new Error(`Target item ${targetId} is not in the active top-level checklist.`);
  }
  if (movedId === targetId) {
    return orderedIds;
  }

  const next = [...orderedIds];
  const [moved] = next.splice(fromIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetId);
  const insertAt = placement === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  next.splice(insertAt, 0, moved);
  return next;
}
