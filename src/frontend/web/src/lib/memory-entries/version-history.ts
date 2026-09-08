import type {
  PyMemoryEntryVersionListResponse,
  PyMemoryEntryVersionSummary,
} from "@/lib/content/catalogTypes";

/** Flattens paginated newest-first version pages without duplicate rows. */
export function flattenMemoryEntryVersionPages(
  pages: PyMemoryEntryVersionListResponse[] | undefined,
) {
  const seen = new Set<number>();
  const versions: PyMemoryEntryVersionSummary[] = [];
  for (const page of pages ?? []) {
    for (const version of page.versions ?? []) {
      if (seen.has(version.version)) continue;
      seen.add(version.version);
      versions.push(version);
    }
  }
  return versions.sort((left, right) => right.version - left.version);
}

export function memoryVersionTitle(version: number) {
  return `Changes in Version ${version}`;
}

export function memoryVersionSubtitle(version: number) {
  return version === 1
    ? "Created in Version 1"
    : `Version ${version - 1} → Version ${version}`;
}

export function memoryVersionOperationLabel(
  operation: PyMemoryEntryVersionSummary["operation"],
) {
  if (operation === "create") return "Created";
  if (operation === "update") return "Updated";
  if (operation === "move") return "Moved";
  if (operation === "delete") return "Deleted";
  if (operation === "undo") return "Undone";
  return "Reverted";
}
