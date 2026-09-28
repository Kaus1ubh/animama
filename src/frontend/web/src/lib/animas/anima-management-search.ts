import type { SearchSchemaInput } from "@tanstack/react-router";

export type AnimaListSearch = {
  selected?: string;
};

export const ANIMA_MANAGEMENT_TABS = [
  "overview",
  "memories",
  "emotions",
  "loadout",
  "settings",
] as const;

export type AnimaManagementTab = (typeof ANIMA_MANAGEMENT_TABS)[number];

export type AnimaDetailsSearch = {
  tab: AnimaManagementTab;
};

export type AnimaDetailsSearchInput = {
  tab?: AnimaManagementTab;
} & SearchSchemaInput;

export type AnimasNavigationTarget =
  | { route: "resolver" }
  | { route: "details"; animaId: string };

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/** Normalize roster search state without retaining unknown URL values. */
export function normalizeAnimaListSearch(
  value: Record<string, unknown>,
): AnimaListSearch {
  const selected = nonEmptyString(value.selected);
  return selected ? { selected } : {};
}

/** Recover roster selection from a full-reload URL. */
export function animaListSearchFromUrl(url: URL): AnimaListSearch {
  return normalizeAnimaListSearch({
    selected: url.searchParams.get("selected"),
  });
}

/** Normalize details tabs to the safe default used by the management route. */
export function normalizeAnimaDetailsSearch(
  value: Record<string, unknown>,
): AnimaDetailsSearch {
  const requestedTab = value.tab;
  const tab = ANIMA_MANAGEMENT_TABS.includes(requestedTab as AnimaManagementTab)
    ? (requestedTab as AnimaManagementTab)
    : "overview";
  return { tab };
}

/** Recover the normalized management tab from a full-reload URL. */
export function animaDetailsSearchFromUrl(url: URL): AnimaDetailsSearch {
  return normalizeAnimaDetailsSearch({
    tab: url.searchParams.get("tab") ?? undefined,
  });
}

/** Resolve the sidebar's Animas destination without persisting selection. */
export function resolveAnimasNavigationTarget(
  currentAnimaId: string | null | undefined,
): AnimasNavigationTarget {
  const animaId = nonEmptyString(currentAnimaId);
  return animaId ? { route: "details", animaId } : { route: "resolver" };
}

/** Resolve New Chat to the route Anima, remembered owned Anima, or first owned Anima. */
export function resolveNewChatAnimaId(
  currentAnimaId: string | null | undefined,
  rememberedAnimaId: string | null | undefined,
  orderedOwnedAnimaIds: readonly string[],
): string | null {
  const current = nonEmptyString(currentAnimaId);
  if (current) return current;
  return resolveSelectedAnimaId(orderedOwnedAnimaIds, rememberedAnimaId);
}

/** Resolve the compatibility route to the first row in caller-owned order. */
export function resolveFirstOwnedAnimaId(
  orderedAnimaIds: readonly string[],
): string | null {
  return orderedAnimaIds[0] ?? null;
}

/**
 * Resolve an effective selection while treating stale or unauthorized IDs as
 * absent. Ordering is supplied by the caller so list reordering stays explicit.
 */
export function resolveSelectedAnimaId(
  orderedAnimaIds: readonly string[],
  requestedAnimaId?: string | null,
): string | null {
  if (
    requestedAnimaId &&
    orderedAnimaIds.some((animaId) => animaId === requestedAnimaId)
  ) {
    return requestedAnimaId;
  }
  return orderedAnimaIds[0] ?? null;
}

/**
 * Return the adjacent Anima ID with wraparound. Empty and unresolved
 * selections return null rather than inventing navigation state.
 */
export function adjacentAnimaId(
  orderedAnimaIds: readonly string[],
  selectedAnimaId: string | null,
  direction: -1 | 1,
): string | null {
  if (orderedAnimaIds.length === 0 || !selectedAnimaId) return null;
  const selectedIndex = orderedAnimaIds.indexOf(selectedAnimaId);
  if (selectedIndex < 0) return null;
  const nextIndex =
    (selectedIndex + direction + orderedAnimaIds.length) %
    orderedAnimaIds.length;
  return orderedAnimaIds[nextIndex] ?? null;
}
