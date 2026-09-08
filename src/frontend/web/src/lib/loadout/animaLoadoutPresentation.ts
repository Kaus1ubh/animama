import type {
  PyAnimaLoadout,
  PyCatalogLoadoutSource,
  PyGestureBinding,
} from "@animama/runtime-contracts/api-types";
import type {
  PyExactContentSource,
  PyGesture,
} from "@/lib/content/catalogTypes";

export type GestureLoadoutPresentation = {
  starter: PyGestureBinding[];
  custom: PyGestureBinding[];
  disabledStarter: Array<{
    starterId: string;
    motionType: PyGesture["implementation_kind"] | null;
    gesture: PyGesture | null;
  }>;
  starterSummary: string;
};

export type CustomGestureCatalogRow = {
  gesture: PyGesture;
  binding: PyGestureBinding | null;
};

export type CustomGestureCatalogPresentation = {
  rows: CustomGestureCatalogRow[];
  unlistedEquipped: PyGestureBinding[];
};

export type UnifiedGestureListRow = {
  id: string;
  kind: "custom" | "starter";
  name: string;
  description: string | null;
  equipped: boolean;
  updateAvailable: boolean;
  motionType: PyGesture["implementation_kind"] | null;
  gesture: PyGesture | null;
  binding: PyGestureBinding | null;
  starterId: string | null;
};

export type UnifiedGestureListPresentation = {
  rows: UnifiedGestureListRow[];
  equippedCount: number;
  customCount: number;
  starterCount: number;
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

/** Reconcile ready owned Gestures with the exact bindings on this Anima. */
export function presentCustomGestureCatalog(
  gestures: PyGesture[],
  equipped: PyGestureBinding[],
): CustomGestureCatalogPresentation {
  const rows = gestures
    .filter(
      (gesture) =>
        gesture.origin === "owned" &&
        gesture.state === "ready" &&
        Boolean(gesture.source),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
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

/** Build the searchable custom-first list used by the Anima Loadout panel. */
export function presentUnifiedGestureList({
  presentation,
  catalog,
  showStarters,
  updatesOnly,
  status,
  motionType,
  sort,
  query,
}: {
  presentation: GestureLoadoutPresentation;
  catalog: CustomGestureCatalogPresentation;
  showStarters: boolean;
  updatesOnly: boolean;
  status: UnifiedGestureStatusFilter;
  motionType: UnifiedGestureMotionFilter;
  sort: UnifiedGestureSort;
  query: string;
}): UnifiedGestureListPresentation {
  const customRows: UnifiedGestureListRow[] = [
    ...catalog.rows.map(({ gesture, binding }) => ({
      id: `custom:${gesture.item_id}`,
      kind: "custom" as const,
      name: gesture.name,
      description: gesture.description ?? null,
      equipped: Boolean(binding),
      updateAvailable: false,
      motionType: binding?.implementation_kind ?? gesture.implementation_kind,
      gesture,
      binding,
      starterId: null,
    })),
    ...catalog.unlistedEquipped.map((binding) => ({
      id: `custom-binding:${binding.binding_id}`,
      kind: "custom" as const,
      name: binding.name,
      description: binding.description ?? null,
      equipped: true,
      updateAvailable: false,
      motionType: binding.implementation_kind,
      gesture: null,
      binding,
      starterId: null,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name));

  const starterRows: UnifiedGestureListRow[] = [
    ...presentation.starter.map((binding) => ({
      id: `starter:${binding.binding_id}`,
      kind: "starter" as const,
      name: binding.name,
      description: binding.description ?? null,
      equipped: true,
      updateAvailable: false,
      motionType: binding.implementation_kind,
      gesture: null,
      binding,
      starterId: binding.semantic_key,
    })),
    ...presentation.disabledStarter.map(
      ({ starterId, motionType, gesture }) => ({
        id: `starter-disabled:${starterId}`,
        kind: "starter" as const,
        name: gesture?.name ?? starterId,
        description: gesture?.description ?? null,
        equipped: false,
        updateAvailable: false,
        motionType: gesture?.implementation_kind ?? motionType,
        gesture,
        binding: null,
        starterId,
      }),
    ),
  ].sort((left, right) => left.name.localeCompare(right.name));

  const allRows = [...customRows, ...starterRows];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rows = [...customRows, ...(showStarters ? starterRows : [])].filter(
    (row) => {
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
        matchesQuery &&
        matchesStatus &&
        matchesMotionType &&
        (!updatesOnly || row.updateAvailable)
      );
    },
  );

  if (sort !== "custom-first") {
    const direction = sort === "name-asc" ? 1 : -1;
    rows.sort(
      (left, right) =>
        direction * left.name.localeCompare(right.name) ||
        direction * left.id.localeCompare(right.id),
    );
  }

  return {
    rows,
    equippedCount: allRows.filter((row) => row.equipped).length,
    customCount: customRows.length,
    starterCount: starterRows.length,
    updateAvailableCount: allRows.filter((row) => row.updateAvailable).length,
    motionTypeCounts: {
      anima_clip: allRows.filter((row) => row.motionType === "anima_clip")
        .length,
      vrma: allRows.filter((row) => row.motionType === "vrma").length,
    },
  };
}

/** Keep Starter inventory compact while preserving custom typed roots. */
export function presentGestureLoadout(
  loadout: PyAnimaLoadout,
  builtinGestures: readonly PyGesture[] = [],
): GestureLoadoutPresentation {
  const starter = loadout.gestures.filter((row) => row.origin === "starter");
  const custom = loadout.gestures.filter((row) => row.origin === "custom");
  const disabled = loadout.disabled_starter_gestures.length;
  const builtinBySemanticKey = new Map(
    builtinGestures
      .filter(
        (gesture) =>
          gesture.origin === "builtin" &&
          gesture.state === "ready" &&
          Boolean(gesture.source),
      )
      .map((gesture) => [gesture.semantic_key, gesture]),
  );
  return {
    starter,
    custom,
    disabledStarter: loadout.disabled_starter_gestures.map((starterId) => ({
      starterId,
      motionType:
        loadout.starter_gesture_implementation_kinds?.[starterId] ?? null,
      gesture: builtinBySemanticKey.get(starterId) ?? null,
    })),
    starterSummary: `${starter.length} active${disabled ? ` · ${disabled} disabled` : ""}`,
  };
}

/** Product-facing state label for a canonical Reaction cell. */
export function reactionStateLabel(
  state: "starter" | "custom" | "empty",
): string {
  if (state === "starter") return "Starter";
  if (state === "custom") return "Custom";
  return "Empty";
}
