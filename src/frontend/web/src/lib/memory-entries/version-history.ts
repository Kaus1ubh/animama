import { getI18n } from "react-i18next";

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

/** Heading for the adjacent change that produced `version`, worded at call time. */
export function memoryVersionTitle(version: number) {
  const t = getI18n().getFixedT(null, "memory");
  return t("versions.changesIn", { version });
}

export function memoryVersionSubtitle(version: number) {
  const t = getI18n().getFixedT(null, "memory");
  return version === 1
    ? t("versions.createdIn", { version })
    : t("versions.range", { from: version - 1, to: version });
}

/** The change provenance automatic episode processing writes (backend `AUTOMATIC_EPISODE_PROCESSING_TRIGGER`). */
const AUTOMATIC_EPISODE_PROCESSING_TRIGGER = "automatic_episode_processing";

/** The version's operation, or that automatic episode processing wrote it. */
export function memoryVersionChangeLabel(
  version: Pick<PyMemoryEntryVersionSummary, "operation" | "change_metadata">,
) {
  const t = getI18n().getFixedT(null, "memory");
  if (
    version.change_metadata?.trigger === AUTOMATIC_EPISODE_PROCESSING_TRIGGER
  ) {
    return t("versions.automaticUpdate");
  }
  return memoryVersionOperationLabel(version.operation);
}

export function memoryVersionOperationLabel(
  operation: PyMemoryEntryVersionSummary["operation"],
) {
  const t = getI18n().getFixedT(null, "memory");
  if (operation === "create") return t("versions.operations.create");
  if (operation === "update") return t("versions.operations.update");
  if (operation === "move") return t("versions.operations.move");
  if (operation === "delete") return t("versions.operations.delete");
  if (operation === "undo") return t("versions.operations.undo");
  return t("versions.operations.revert");
}
