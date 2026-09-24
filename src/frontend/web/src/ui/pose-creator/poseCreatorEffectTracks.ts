import { isAnimaPoseClipVFXEvent } from "@/lib/avatar";
import type { PoseCreatorClipEventDraft } from "./poseCreatorClipAuthoring";
import type { PoseCreatorEventCatalog } from "./poseCreatorEventCatalog";

/** Separate content identity from event identity: repeated uses share a track. */
export function buildEffectTracks(
  events: readonly PoseCreatorClipEventDraft[],
  duration: number,
  catalog: PoseCreatorEventCatalog,
) {
  const groups = new Map<
    string,
    {
      label: string;
      kind: PoseCreatorClipEventDraft["kind"];
      events: PoseCreatorClipEventDraft[];
    }
  >();
  for (const event of events) {
    const id =
      event.kind === "scene_vfx"
        ? event.presetId
        : event.kind === "sfx"
          ? event.cueId
          : event.effectId;
    const key = `${event.kind}:${event.kind === "scene_vfx" ? event.sceneKind : ""}:${id}`;
    const options =
      event.kind === "avatar_vfx"
        ? catalog.avatarVFX
        : event.kind === "particle_vfx"
          ? catalog.particleVFX
          : event.kind === "sfx"
            ? catalog.sfx
            : event.sceneKind === "background_layers"
              ? catalog.sceneBackground
              : catalog.sceneFocus;
    const group = groups.get(key) ?? {
      label: options.find((option) => option.id === id)?.label ?? id,
      kind: event.kind,
      events: [],
    };
    group.events.push(event);
    groups.set(key, group);
  }
  let nextRow = 1; // The first row always belongs to pose/expression keyframes.
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, group]) => {
      const rowEnds: number[] = [];
      const entries = [...group.events]
        .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
        .map((event) => {
          const end = isAnimaPoseClipVFXEvent(event)
            ? Math.min(duration, event.time + (event.duration ?? duration))
            : event.time;
          // Point cues at exactly the same time also need independent hit targets.
          const occupiedUntil = Math.max(event.time + 0.001, end);
          let row = rowEnds.findIndex((value) => value <= event.time);
          if (row < 0) row = rowEnds.length;
          rowEnds[row] = occupiedUntil;
          return { event, end, row: nextRow + row };
        });
      const track = {
        id,
        label: group.label,
        kind: group.kind,
        firstRow: nextRow,
        rowCount: rowEnds.length,
        entries,
      };
      nextRow += rowEnds.length;
      return track;
    });
}
