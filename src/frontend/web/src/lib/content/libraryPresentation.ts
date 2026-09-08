import type {
  PyCatalogViewItem,
  PyGesture,
  PyReaction,
} from "@/lib/content/catalogTypes";
import type { ContentLibrarySearch } from "@/lib/content/librarySearch";

export type LibraryProductCard = {
  key: string;
  itemId: string;
  family:
    | "gesture"
    | "reaction"
    | "particle"
    | "avatar-effect"
    | "scene"
    | "sound";
  name: string;
  description: string;
  origin: "Built-in" | "Mine";
  sourceLabel: string;
  updateAvailable: boolean;
  equippedCount: number;
  includedCount: number;
  source: PyGesture["source"];
  emotion?: string;
  intensity?: number;
};

export type LibraryProductActionPolicy = {
  preview: boolean;
  manage: boolean;
  edit: boolean;
  useInGesture: boolean;
  useInReaction: boolean;
};

type LibraryGestureFilters = Pick<
  ContentLibrarySearch,
  "gestureUpdatesOnly" | "gestureStatus" | "gestureSort"
>;

/** Apply the Gesture-only Library filters shared with the Anima Loadout UI. */
export function filterAndSortLibraryGestures(
  cards: LibraryProductCard[],
  filters: LibraryGestureFilters,
): LibraryProductCard[] {
  const rows = cards
    .filter((card) => !filters.gestureUpdatesOnly || card.updateAvailable)
    .filter(
      (card) =>
        filters.gestureStatus === "all" ||
        (filters.gestureStatus === "equipped"
          ? card.equippedCount > 0
          : card.equippedCount === 0),
    );

  if (filters.gestureSort === "custom-first") {
    return [
      ...rows.filter((card) => card.origin === "Mine"),
      ...rows.filter((card) => card.origin === "Built-in"),
    ];
  }
  const direction = filters.gestureSort === "name-asc" ? 1 : -1;
  return rows.sort(
    (left, right) =>
      direction * left.name.localeCompare(right.name) ||
      direction * left.key.localeCompare(right.key),
  );
}

/** Keep product-specific Library actions explicit while sharing one row shell. */
export function libraryProductActionPolicy(
  card: LibraryProductCard,
): LibraryProductActionPolicy {
  const action = card.family === "gesture" || card.family === "reaction";
  const reusableEffect = !action;
  const editable =
    card.origin === "Mine" &&
    Boolean(card.source) &&
    (action || reusableEffect);
  return {
    preview: Boolean(card.source),
    manage: action && Boolean(card.source),
    edit: editable,
    useInGesture: reusableEffect && Boolean(card.source),
    useInReaction: reusableEffect && Boolean(card.source),
  };
}

/** Build the compact primary metadata shown before a row is expanded. */
export function libraryProductMetadata(card: LibraryProductCard): string[] {
  return [
    card.sourceLabel,
    card.origin,
    ...(card.emotion ? [`${card.emotion} Level ${card.intensity ?? 1}`] : []),
    ...(card.equippedCount
      ? [
          `Added to ${card.equippedCount} Anima${card.equippedCount === 1 ? "" : "s"}`,
        ]
      : []),
    ...(card.updateAvailable ? ["Update available"] : []),
  ];
}

export type LibraryRowPresentation = {
  family: LibraryProductCard["family"] | "avatar";
  name: string;
  description: string;
  metadata: string[];
  origin: "Built-in" | "Mine";
  includedCount?: number;
  updateAvailable?: boolean;
  equippedCount?: number;
};

/** Adapt a typed product card to the compact row presentation contract. */
export function libraryRowPresentation(
  card: LibraryProductCard,
): LibraryRowPresentation {
  return {
    family: card.family,
    name: card.name,
    description: card.description,
    metadata: libraryProductMetadata(card),
    origin: card.origin,
    includedCount: card.includedCount,
    updateAvailable: card.updateAvailable,
    equippedCount: card.equippedCount,
  };
}

/** Extract one readable scan-line description from Avatar identity markdown. */
export function avatarLibraryDescription(value: string | null | undefined) {
  const line = (value ?? "")
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !candidate.startsWith("#"));
  return line?.replace(/^[-*+]\s+/, "") || "VRM Avatar";
}

function reactionPlacement(value: PyReaction) {
  const hint = value.metadata?.placement_hint;
  if (!hint || typeof hint !== "object") return {};
  const raw = hint as Record<string, unknown>;
  return typeof raw.emotion === "string" && typeof raw.intensity === "number"
    ? { emotion: raw.emotion, intensity: raw.intensity }
    : {};
}

/** Present one stable product identity independent of files or implementation. */
export function actionLibraryCard(
  family: "gesture" | "reaction",
  value: PyGesture | PyReaction,
): LibraryProductCard {
  return {
    key: `${family}:${value.origin}:${value.item_id}`,
    itemId: value.item_id,
    family,
    name: value.name,
    description: value.description?.trim() || "No description",
    origin: value.origin === "builtin" ? "Built-in" : "Mine",
    sourceLabel: value.catalog_source === "included" ? "Included" : "Local",
    updateAvailable: value.update_available ?? false,
    equippedCount: 0,
    includedCount: Object.values(value.included_resource_counts ?? {}).reduce(
      (total, count) => total + count,
      0,
    ),
    source: value.source,
    ...(family === "reaction" ? reactionPlacement(value as PyReaction) : {}),
  };
}

export function effectLibraryCard(
  family: "particle" | "avatar-effect" | "scene" | "sound",
  value: PyCatalogViewItem,
): LibraryProductCard {
  return {
    key: `${family}:${value.origin}:${value.item_id}`,
    itemId: value.item_id,
    family,
    name: value.name,
    description: value.description?.trim() || "No description",
    origin: value.origin === "builtin" ? "Built-in" : "Mine",
    sourceLabel: value.catalog_source === "included" ? "Included" : "Local",
    updateAvailable: false,
    equippedCount: 0,
    includedCount: 0,
    source: value.source,
  };
}
