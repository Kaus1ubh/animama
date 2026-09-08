import type { PyAnimaListItem } from "@/lib/content/catalogTypes";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";

export type ContentCreatorPreviewAnimaStatus =
  | "remembered"
  | "fallback"
  | "stale_fallback"
  | "none";

export type ContentCreatorPreviewAnimaSelection = {
  anima: PyAnimaListItem | null;
  status: ContentCreatorPreviewAnimaStatus;
};

type ContentCreatorModelSourceBase = {
  key: string;
  displayName: string;
  versionLabel: string;
  sourceLabel: "Preview Anima" | "Built-in Avatar" | "My Avatar";
  runtimeId: string;
  configSchemaVersion: number;
  config: Record<string, unknown>;
};

export type ContentCreatorModelSource = ContentCreatorModelSourceBase & {
  sourceType: "resolved_entry";
  animaId: string;
  effectiveRevision: string;
  contentRevision: string;
};

/** Select the remembered owned Anima, or the first deterministic fallback. */
export function selectContentCreatorPreviewAnima(
  animas: readonly PyAnimaListItem[],
  rememberedAnimaId: string | null | undefined,
): ContentCreatorPreviewAnimaSelection {
  if (animas.length === 0) return { anima: null, status: "none" };
  if (rememberedAnimaId) {
    const remembered = animas.find((anima) => anima.id === rememberedAnimaId);
    if (remembered) return { anima: remembered, status: "remembered" };
    return { anima: animas[0] ?? null, status: "stale_fallback" };
  }
  return { anima: animas[0] ?? null, status: "fallback" };
}

/** Persist only a valid owned route Anima that differs from the preference. */
export function shouldPersistLastActiveAnima(input: {
  routeAnimaId: string | null | undefined;
  rememberedAnimaId: string | null | undefined;
  ownedAnimaIds: readonly string[];
}): boolean {
  return Boolean(
    input.routeAnimaId &&
    input.routeAnimaId !== input.rememberedAnimaId &&
    input.ownedAnimaIds.includes(input.routeAnimaId),
  );
}

/** Capture one Anima's exact resolved model without persisting its entry. */
export function contentCreatorModelSourceFromAnima(
  animaId: string,
  runtime: AnimaRuntimeCatalogSnapshot,
): ContentCreatorModelSource {
  const entry = runtime.avatar_model;
  if (!entry) {
    throw new Error("The selected Anima does not have an available Avatar.");
  }
  return {
    key: `resolved:${animaId}:${runtime.effective_revision}:${entry.content_revision}`,
    sourceType: "resolved_entry",
    animaId,
    effectiveRevision: runtime.effective_revision,
    contentRevision: entry.content_revision,
    displayName: entry.display_name,
    versionLabel: "Equipped on preview Anima",
    sourceLabel: "Preview Anima",
    runtimeId: entry.runtime_id,
    configSchemaVersion: entry.config_schema_version,
    config: { ...entry.config },
  };
}

/** Resolve an immutable model identity through the existing preview contract. */
export function contentCreatorModelPreviewTarget(input: {
  source: ContentCreatorModelSource | null;
  animaId: string | null;
  runtime: AnimaRuntimeCatalogSnapshot | null;
  ownerKey: string;
}): ContentPreviewTarget | null {
  const source = input.source;
  if (!source) return null;
  const base = {
    key: `${input.ownerKey}:${source.key}`,
    kind: "avatar_model" as const,
    displayName: source.displayName,
    versionLabel: source.versionLabel,
    slot: "primary_model" as const,
    runtimeId: source.runtimeId,
    configSchemaVersion: source.configSchemaVersion,
    config: { ...source.config },
  };
  const entry = input.runtime?.avatar_model ?? null;
  if (
    !entry ||
    input.animaId !== source.animaId ||
    input.runtime?.effective_revision !== source.effectiveRevision ||
    entry.content_revision !== source.contentRevision
  ) {
    return null;
  }
  return { ...base, sourceType: "resolved_entry", entry };
}

export function contentCreatorModelSourcesEqual(
  left: ContentCreatorModelSource | null,
  right: ContentCreatorModelSource | null,
): boolean {
  return left?.key === right?.key;
}
