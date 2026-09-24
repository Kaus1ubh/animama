import { describe, expect, it } from "vitest";
import { buildEffectTracks } from "./poseCreatorEffectTracks";
import { createPoseCreatorEventCatalog } from "./poseCreatorEventCatalog";
import type { PoseCreatorClipEventDraft } from "./poseCreatorClipAuthoring";

const catalog = createPoseCreatorEventCatalog(null);
const event = (
  id: string,
  time: number,
  duration?: number,
): Extract<PoseCreatorClipEventDraft, { kind: "avatar_vfx" }> => ({
  id,
  kind: "avatar_vfx",
  effectId: "eyes",
  time,
  ...(duration === undefined ? {} : { duration }),
});

describe("named effect tracks", () => {
  it("shares a track for repeated content and stacks only overlapping intervals", () => {
    const [track] = buildEffectTracks(
      [event("a", 0, 1), event("b", 0.5, 1), event("c", 1, 0.5)],
      2,
      catalog,
    );
    expect(track.rowCount).toBe(2);
    expect(track.entries.map((entry) => [entry.event.id, entry.row])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 1],
    ]);
  });
  it("uses catalog names and keeps distinct effects and scene kinds separate", () => {
    const tracks = buildEffectTracks(
      [
        event("a", 0),
        { ...event("b", 0), effectId: "stars" },
        {
          id: "c",
          kind: "scene_vfx",
          sceneKind: "focus_lines",
          presetId: "eyes",
          time: 0,
        },
        {
          id: "d",
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "eyes",
          time: 0,
        },
      ],
      2,
      {
        ...catalog,
        avatarVFX: [
          { id: "eyes", label: "Eye =", detail: "", soundOnApply: null },
        ],
      },
    );
    expect(tracks).toHaveLength(4);
    expect(tracks.find((track) => track.kind === "avatar_vfx")?.label).toBe(
      "Eye =",
    );
  });
  it("ends Action-owned bars at the boundary and clips finite spans without changing events", () => {
    const events = [event("a", 0.5), event("b", 1, 5)];
    const [track] = buildEffectTracks(events, 2, catalog);
    expect(track.entries.map((entry) => entry.end)).toEqual([2, 2]);
    expect(events[1]).toMatchObject({ duration: 5 });
  });
  it("keeps simultaneous sound cues independently selectable", () => {
    const [track] = buildEffectTracks(
      [
        { id: "a", kind: "sfx", cueId: "pop", time: 1 },
        { id: "b", kind: "sfx", cueId: "pop", time: 1 },
      ],
      2,
      catalog,
    );
    expect(track.rowCount).toBe(2);
    expect(track.entries.map((entry) => entry.end)).toEqual([1, 1]);
  });
});
