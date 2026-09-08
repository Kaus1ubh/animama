import type { PyMemoryPatchPreview } from "@/lib/content/catalogTypes";

export type MemoryDescriptionChangeKind = "set" | "clear" | "replace";

export interface MemoryDescriptionChange {
  kind: MemoryDescriptionChangeKind;
  oldValue: string | null;
  newValue: string | null;
}

/** Projects normalized approval metadata into one user-facing description change. */
export function memoryDescriptionChange(
  preview: Pick<PyMemoryPatchPreview, "old_description" | "new_description">,
): MemoryDescriptionChange | null {
  const oldValue = preview.old_description ?? null;
  const newValue = preview.new_description ?? null;
  if (oldValue === newValue) return null;
  return {
    kind: oldValue === null ? "set" : newValue === null ? "clear" : "replace",
    oldValue,
    newValue,
  };
}
