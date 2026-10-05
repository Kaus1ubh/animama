import { describe, expect, it } from "vitest";

import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { POSE_CREATOR_CLIP_VALIDATION_OPTIONS } from "@/stores/pose-creator-store";
import { createPoseCreatorClipDraftFromAnimaPoseClip } from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { createActionDocument } from "./actionDocument";
import { actionSequenceFromTimelineDraft } from "./actionPersistence";
import { createActionProject, parseActionImport } from "./actionProject";

const metadata = {
  // Exact additive layer IDs declared by the reviewed current-main format.
  // This rollback point preserves them as data; it does not execute new mutes.
  mutedProceduralLayers: [
    "breathing",
    "sway",
    "bounce",
    "headNod",
    "headSideTilt",
    "cursorLookAt",
    "emotionPosture",
  ],
  generator: { tool: "animama-animation", source: "wave.motion.json" },
  futureMetadata: { enabled: false, tags: ["reviewed"] },
};

const clip = {
  schema: "animaPoseClip/1.0",
  id: "wave",
  name: "Wave",
  role: "motion",
  duration: 1,
  ...metadata,
  playback: {
    lifetime: { kind: "whileInteractionPhase", phases: ["talking"] },
  },
  poses: {
    a: { expressions: { happy: 0 } },
    b: { expressions: { happy: 1 } },
  },
  poseKeyframes: [
    { time: 0, pose: "a" },
    { time: 1, pose: "b" },
  ],
};

const draftOf = (value: unknown) =>
  createPoseCreatorClipDraftFromAnimaPoseClip(value, {
    ...POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
    fallbackBasePose: "",
  });

describe("hosted artifact clip round-trip compatibility", () => {
  it("retains newer metadata through the existing import, edit, save and export path", () => {
    const imported = parseActionImport(clip, "gesture");
    if (imported.kind !== "clip")
      throw new Error("Expected a bare clip import");
    const draft = draftOf(imported.sequence);
    const saved = actionSequenceFromTimelineDraft(
      { ...draft, name: "Big Wave" },
      "gesture",
    )!;
    expect(saved).toMatchObject({
      ...metadata,
      name: "Big Wave",
      role: "motion",
      playback: clip.playback,
    });
    const document = createActionDocument("gesture");
    document.name = "Big Wave";
    document.sequence = saved;
    const reopened = parseActionImport(
      JSON.parse(JSON.stringify(createActionProject(document))),
      "gesture",
    );
    if (reopened.kind !== "project")
      throw new Error("Expected a project import");
    expect(parseAnimaPoseClip(reopened.project.sequence)).toMatchObject(
      metadata,
    );
    // A draft must not retain references to mutable imported metadata.
    const future = clip.futureMetadata;
    future.tags.push("later");
    expect(saved.futureMetadata).toEqual({
      enabled: false,
      tags: ["reviewed"],
    });
    future.tags.pop();
  });

  it("retains opaque metadata when saving a playable effect-only timeline", () => {
    const effectOnly = {
      ...clip,
      poses: {},
      poseKeyframes: [],
      events: [
        {
          id: "sparkles",
          time: 0.4,
          kind: "particle_vfx",
          effectId: "sparkles",
          duration: 0.2,
        },
      ],
    };
    const saved = actionSequenceFromTimelineDraft(
      draftOf(effectOnly),
      "gesture",
    );
    expect(saved).toMatchObject({
      ...metadata,
      playback: clip.playback,
      events: effectOnly.events,
    });
  });
});
