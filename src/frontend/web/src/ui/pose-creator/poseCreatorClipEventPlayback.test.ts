import { describe, expect, it } from "vitest";

import { parseAnimaPoseClip } from "@/lib/avatar";
import {
  activeVFXEventsBeforePlaybackStart,
  poseCreatorScrubVFXSignature,
  samplePoseCreatorScrubVFXEvents,
} from "./poseCreatorClipEventPlayback";

describe("creator clip event playback", () => {
  const clip = parseAnimaPoseClip({
    schema: "animaPoseClip/2.0",
    id: "boundary-particles",
    name: "Boundary particles",
    duration: 2,
    beats: [],
    events: [
      {
        id: "at-start",
        time: 0,
        kind: "particle_vfx",
        effectId: "hearts",
        duration: 2,
      },
      {
        id: "at-resume",
        time: 1,
        kind: "particle_vfx",
        effectId: "sparkles",
        duration: 1,
      },
    ],
  });

  it("leaves exact-boundary effects to due-event dispatch", () => {
    expect(activeVFXEventsBeforePlaybackStart(clip, 0)).toEqual([]);
    expect(
      activeVFXEventsBeforePlaybackStart(clip, 1).map(
        (active) => active.event.id,
      ),
    ).toEqual(["at-start"]);
  });

  it("does not replay transient particle emitters while scrubbing", () => {
    expect(samplePoseCreatorScrubVFXEvents(clip, 0.5)).toEqual([]);
  });

  it("keeps a stable scene effect mounted while scrubbing its interval", () => {
    const sceneClip = parseAnimaPoseClip({
      schema: "animaPoseClip/2.0",
      id: "scene-scrub",
      name: "Scene scrub",
      duration: 2,
      beats: [],
      events: [
        {
          id: "focus",
          time: 0.25,
          kind: "scene_vfx",
          sceneKind: "focus_lines",
          presetId: "speed-lines",
          duration: 1,
        },
      ],
    });
    const atHalf = samplePoseCreatorScrubVFXEvents(sceneClip, 0.5);
    const atThreeQuarters = samplePoseCreatorScrubVFXEvents(sceneClip, 0.75);

    expect(atHalf.map((active) => active.event.id)).toEqual(["focus"]);
    expect(
      poseCreatorScrubVFXSignature(sceneClip, atThreeQuarters, "catalog-v1"),
    ).toBe(poseCreatorScrubVFXSignature(sceneClip, atHalf, "catalog-v1"));
    expect(samplePoseCreatorScrubVFXEvents(sceneClip, 1.5)).toEqual([]);
  });

  it("remounts scrubbed scene effects when their local catalog becomes ready", () => {
    const sceneClip = parseAnimaPoseClip({
      schema: "animaPoseClip/2.0",
      id: "scene-catalog-refresh",
      name: "Scene catalog refresh",
      duration: 1,
      beats: [],
      events: [
        {
          id: "background",
          time: 0,
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "comic-pop",
        },
      ],
    });
    const active = samplePoseCreatorScrubVFXEvents(sceneClip, 0.5);

    expect(poseCreatorScrubVFXSignature(sceneClip, active, null)).not.toBe(
      poseCreatorScrubVFXSignature(sceneClip, active, "catalog-v2"),
    );
  });
});
