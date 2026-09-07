/**
 * Reorders a task's assignee list so the CURRENT VIEWER's own entry (if
 * they're assigned) always renders first in the avatar stack — a purely
 * display-time reorder, not persisted. Jordan: "the user looking at the
 * assignee should always see their avatar first" — so Jordan and Priya
 * looking at the same task each see their own avatar leading the stack.
 */
export function sortAssigneesForViewer<T extends { id: string }>(assignees: T[], viewerId: string): T[] {
  const index = assignees.findIndex((a) => a.id === viewerId);
  if (index <= 0) return assignees;
  const next = [...assignees];
  const [mine] = next.splice(index, 1);
  next.unshift(mine);
  return next;
}
