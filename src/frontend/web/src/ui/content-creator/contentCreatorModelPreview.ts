import { getI18n } from "react-i18next";

import type { PyAnimaListItem } from "@/lib/content/catalogTypes";
import { WordedError } from "@/lib/errors/apiError";
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

/** The exact model equipped on an Anima, from its runtime snapshot. */
export type ContentCreatorAnimaModelSource = ContentCreatorModelSourceBase & {
  sourceType: "resolved_entry";
  animaId: string;
  effectiveRevision: string;
  contentRevision: string;
};

/** An Included Avatar, previewed through its catalog item. */
export type ContentCreatorIncludedAvatarSource =
  ContentCreatorModelSourceBase & {
    sourceType: "included_avatar";
    itemId: string;
  };

export type ContentCreatorModelSource =
  | ContentCreatorAnimaModelSource
  | ContentCreatorIncludedAvatarSource;

/** The Avatar catalog item behind a model source, for face part corrections. */
export function contentCreatorModelCatalogItemId(
  source: ContentCreatorModelSource | null,
): string | null {
  if (!source) return null;
  if (source.sourceType === "included_avatar") return source.itemId;
  const itemId = source.config.avatar_catalog_item_id;
  return typeof itemId === "string" && itemId ? itemId : null;
}

/** A model option for one Included Avatar catalog item. */
export function contentCreatorIncludedAvatarSource(item: {
  catalog_item_id: string;
  name: string;
}): ContentCreatorIncludedAvatarSource {
  return {
    key: `included:${item.catalog_item_id}`,
    sourceType: "included_avatar",
    itemId: item.catalog_item_id,
    displayName: item.name,
    versionLabel: "Included Avatar",
    sourceLabel: "Built-in Avatar",
    runtimeId: `included-avatar-${item.catalog_item_id}`,
    configSchemaVersion: 1,
    config: {},
  };
}

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
): ContentCreatorAnimaModelSource {
  const entry = runtime.avatar_model;
  if (!entry) {
    const t = getI18n().getFixedT(null, "creator");
    throw new WordedError(t("modelPreview.noAvatar"));
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
  // Included Avatars resolve through their catalog preview instead.
  if (!source || source.sourceType !== "resolved_entry") return null;
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
