import type {
  PyCatalogLoadoutSource,
  PyGestureBinding,
} from "@animama/runtime-contracts/api-types";
import type {
  PyExactContentSource,
  PyGesture,
} from "@/lib/content/catalogTypes";
import { compareDisplayText } from "@animama/product-ui/i18n";

export type GestureCatalogRow = {
  gesture: PyGesture;
  binding: PyGestureBinding | null;
};

export type GestureCatalogPresentation = {
  rows: GestureCatalogRow[];
  unlistedEquipped: PyGestureBinding[];
};

export type UnifiedGestureListRow = {
  id: string;
  source: "included" | "local";
  name: string;
  description: string | null;
  equipped: boolean;
  updateAvailable: boolean;
  motionType: PyGesture["implementation_kind"] | null;
  gesture: PyGesture | null;
  binding: PyGestureBinding | null;
};

export type UnifiedGestureListPresentation = {
  rows: UnifiedGestureListRow[];
  equippedCount: number;
  totalCount: number;
  includedCount: number;
  localCount: number;
  updateAvailableCount: number;
  motionTypeCounts: Record<PyGesture["implementation_kind"], number>;
};

export type UnifiedGestureStatusFilter = "all" | "equipped" | "unequipped";

export type UnifiedGestureSort = "custom-first" | "name-asc" | "name-desc";

export type UnifiedGestureMotionFilter =
  | "all"
  | PyGesture["implementation_kind"];

function sameExactSource(
  binding: PyCatalogLoadoutSource,
  available: PyExactContentSource | null,
): boolean {
  if (!available || available.type !== "catalog") return false;
  return binding.catalog_item_id === available.catalog_item_id;
}

/** Reconcile the full ready catalog with the exact bindings on this Anima. */
export function presentGestureCatalog(
  gestures: PyGesture[],
  equipped: PyGestureBinding[],
): GestureCatalogPresentation {
  const readyGestures = gestures.filter(
    (gesture) => gesture.state === "ready" && Boolean(gesture.source),
  );
  const rows = [
    ...new Map(
      readyGestures.map((gesture) => [gesture.item_id, gesture]),
    ).values(),
  ]
    .sort((left, right) => compareDisplayText(left.name, right.name))
    .map((gesture) => ({
      gesture,
      binding:
        equipped.find(
          (candidate) =>
            candidate.logical_item_id === gesture.item_id ||
            sameExactSource(candidate.source, gesture.source),
        ) ?? null,
    }));
  const representedBindingIds = new Set(
    rows.flatMap((row) => (row.binding ? [row.binding.binding_id] : [])),
  );
  return {
    rows,
    unlistedEquipped: equipped.filter(
      (binding) => !representedBindingIds.has(binding.binding_id),
    ),
  };
}

/** Where the Gesture comes from: Included content or the owner's Local content. */
function gestureSource(gesture: PyGesture): "included" | "local" {
  return gesture.source?.type === "catalog" && gesture.source.source
    ? gesture.source.source
    : gesture.origin === "builtin"
      ? "included"
      : "local";
}

/** Build a searchable catalog without hiding unequipped Included Gestures. */
export function presentUnifiedGestureList({
  catalog,
  showIncluded,
  showLocal,
  updatesOnly,
  status,
  motionType,
  sort,
  query,
}: {
  catalog: GestureCatalogPresentation;
  showIncluded: boolean;
  showLocal: boolean;
  updatesOnly: boolean;
  status: UnifiedGestureStatusFilter;
  motionType: UnifiedGestureMotionFilter;
  sort: UnifiedGestureSort;
  query: string;
}): UnifiedGestureListPresentation {
  const catalogRows: UnifiedGestureListRow[] = catalog.rows.map(
    ({ gesture, binding }) => ({
      id: `catalog:${gesture.item_id}`,
      source: gestureSource(gesture),
      name: gesture.name,
      description: gesture.description ?? null,
      equipped: Boolean(binding),
      updateAvailable: false,
      motionType: binding?.implementation_kind ?? gesture.implementation_kind,
      gesture,
      binding,
    }),
  );
  // Retain loadout-only entries while the catalog loads or a source is unavailable.
  const allRows: UnifiedGestureListRow[] = [
    ...catalogRows,
    ...catalog.unlistedEquipped.map((binding) => ({
      id: `binding:${binding.binding_id}`,
      source: binding.source.source,
      name: binding.name,
      description: binding.description ?? null,
      equipped: true,
      updateAvailable: false,
      motionType: binding.implementation_kind,
      gesture: null,
      binding,
    })),
  ];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rows = allRows.filter((row) => {
    const matchesSource = row.source === "included" ? showIncluded : showLocal;
    const matchesQuery =
      !normalizedQuery ||
      row.name.toLocaleLowerCase().includes(normalizedQuery) ||
      row.description?.toLocaleLowerCase().includes(normalizedQuery);
    const matchesStatus =
      status === "all" ||
      (status === "equipped" ? row.equipped : !row.equipped);
    const matchesMotionType =
      motionType === "all" || row.motionType === motionType;
    return (
      matchesSource &&
      matchesQuery &&
      matchesStatus &&
      matchesMotionType &&
      (!updatesOnly || row.updateAvailable)
    );
  });
  rows.sort((left, right) => {
    // Custom first lists Local Gestures before Included ones, as the Library does.
    if (sort === "custom-first" && left.source !== right.source)
      return left.source === "local" ? -1 : 1;
    const direction = sort === "name-desc" ? -1 : 1;
    return (
      direction *
      (compareDisplayText(left.name, right.name) ||
        left.id.localeCompare(right.id))
    );
  });

  return {
    rows,
    equippedCount: allRows.filter((row) => row.equipped).length,
    totalCount: allRows.length,
    includedCount: allRows.filter((row) => row.source === "included").length,
    localCount: allRows.filter((row) => row.source === "local").length,
    updateAvailableCount: allRows.filter((row) => row.updateAvailable).length,
    motionTypeCounts: {
      anima_clip: allRows.filter((row) => row.motionType === "anima_clip")
        .length,
      vrma: allRows.filter((row) => row.motionType === "vrma").length,
    },
  };
}
