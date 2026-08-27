export type DragDropTarget<Category extends string = string> =
  | { type: "delete" }
  | { type: "category"; category: Category; bookId: string | null }
  | null;

export function isAvailableCategoryDrop<Category extends string>(
  candidate: Category | undefined,
  currentCategory: Category | null,
) {
  return Boolean(candidate) && candidate !== currentCategory;
}

export function resolveCompletedDropTarget<Category extends string>(
  finalTarget: DragDropTarget<Category>,
  highlightedTarget: DragDropTarget<Category>,
  endReason: "release" | "cancel",
): DragDropTarget<Category> {
  if (endReason === "cancel") return null;

  if (finalTarget) return finalTarget;
  return highlightedTarget?.type === "category" ? highlightedTarget : null;
}
