import type {
  AnimaPoseClipEventContext,
  AnimaPoseClipSceneVFXEvent,
} from "@/lib/avatar";
import type {
  SceneFocusLinesVFXEntry,
  SceneVFXEntry,
  SceneVFXKind,
  SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";
import {
  useSceneVFXStore,
  type SceneVFXActiveByKind,
} from "@/stores/scene-vfx-store";

export type ClipOwnedSceneVFXRecord = {
  appliedId: string;
  previousEntry: NonNullable<SceneVFXActiveByKind[SceneVFXKind]> | null;
};

export function resolveClipOwnedSceneVFXEntry(
  event: AnimaPoseClipSceneVFXEvent,
  context: AnimaPoseClipEventContext,
  resolvePreset: (
    kind: SceneVFXKind,
    runtimeId: string,
  ) => SceneVFXEntry | null,
): SceneVFXEntry {
  if (event.sceneKind === "background_layers") {
    const preset = resolvePreset(event.sceneKind, event.presetId);
    if (!preset) {
      throw new Error(
        `Unknown scene background VFX preset "${event.presetId}".`,
      );
    }
    if (preset.kind !== "background_layers") {
      throw new Error(
        `Scene VFX preset "${event.presetId}" has the wrong kind.`,
      );
    }
    return {
      ...preset,
      id: context.appliedId,
      durationMs: null,
    };
  }

  const preset = resolvePreset(event.sceneKind, event.presetId);
  if (!preset) {
    throw new Error(
      `Unknown scene focus-lines VFX preset "${event.presetId}".`,
    );
  }
  if (preset.kind !== "focus_lines") {
    throw new Error(`Scene VFX preset "${event.presetId}" has the wrong kind.`);
  }
  return {
    ...preset,
    id: context.appliedId,
    durationMs: null,
  } satisfies SceneFocusLinesVFXEntry;
}

export function isClipOwnedSceneVFXEntry(
  runtimeEntry: SceneVFXRuntimeEntry | null | undefined,
  appliedId: string,
): boolean {
  return runtimeEntry?.entry.id === appliedId;
}

export function applyClipOwnedSceneVFX(
  records: Map<SceneVFXKind, ClipOwnedSceneVFXRecord>,
  event: AnimaPoseClipSceneVFXEvent,
  context: AnimaPoseClipEventContext,
  options: {
    enabled?: boolean;
    resolvePreset: (
      kind: SceneVFXKind,
      runtimeId: string,
    ) => SceneVFXEntry | null;
  },
): void {
  if (options.enabled === false) return;

  const state = useSceneVFXStore.getState();
  const activeEntry = state.activeByKind[event.sceneKind] ?? null;
  const existingRecord = records.get(event.sceneKind);
  const previousEntry = isClipOwnedSceneVFXEntry(
    activeEntry,
    existingRecord?.appliedId ?? "",
  )
    ? (existingRecord?.previousEntry ?? null)
    : activeEntry;

  records.set(event.sceneKind, {
    appliedId: context.appliedId,
    previousEntry,
  });
  state.applySceneVFX(
    resolveClipOwnedSceneVFXEntry(event, context, options.resolvePreset),
  );
}

export function clearClipOwnedSceneVFX(
  records: Map<SceneVFXKind, ClipOwnedSceneVFXRecord>,
  event: AnimaPoseClipSceneVFXEvent,
  context: AnimaPoseClipEventContext,
): void {
  const record = records.get(event.sceneKind);
  if (!record || record.appliedId !== context.appliedId) return;

  clearClipOwnedSceneVFXRecord(records, event.sceneKind, record);
}

export function clearAllClipOwnedSceneVFX(
  records: Map<SceneVFXKind, ClipOwnedSceneVFXRecord>,
  options: { skipRestoreAppliedIds?: ReadonlySet<string> } = {},
): void {
  for (const [kind, record] of Array.from(records.entries())) {
    clearClipOwnedSceneVFXRecord(records, kind, record, options);
  }
}

export function collectClipOwnedSceneVFXAppliedIds(
  ...recordMaps: Array<Map<SceneVFXKind, ClipOwnedSceneVFXRecord>>
): Set<string> {
  const appliedIds = new Set<string>();
  for (const records of recordMaps) {
    for (const record of records.values()) {
      appliedIds.add(record.appliedId);
    }
  }
  return appliedIds;
}

function clearClipOwnedSceneVFXRecord(
  records: Map<SceneVFXKind, ClipOwnedSceneVFXRecord>,
  kind: SceneVFXKind,
  record: ClipOwnedSceneVFXRecord,
  options: { skipRestoreAppliedIds?: ReadonlySet<string> } = {},
): void {
  const state = useSceneVFXStore.getState();
  const activeEntry = state.activeByKind[kind] ?? null;
  if (isClipOwnedSceneVFXEntry(activeEntry, record.appliedId)) {
    const nextActiveByKind = {
      ...state.activeByKind,
    };
    const skipRestore =
      record.previousEntry &&
      options.skipRestoreAppliedIds?.has(record.previousEntry.entry.id);

    if (skipRestore) {
      delete nextActiveByKind[kind];
    } else if (record.previousEntry?.kind === "background_layers") {
      nextActiveByKind.background_layers = record.previousEntry;
    } else if (record.previousEntry?.kind === "focus_lines") {
      nextActiveByKind.focus_lines = record.previousEntry;
    } else {
      delete nextActiveByKind[kind];
    }
    state.replaceActiveByKind(nextActiveByKind);
  }

  records.delete(kind);
}
