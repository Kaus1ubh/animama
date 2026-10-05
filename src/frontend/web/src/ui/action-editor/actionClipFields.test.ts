import { describe, expect, it } from "vitest";

import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { POSE_CREATOR_CLIP_VALIDATION_OPTIONS } from "@/stores/pose-creator-store";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { createActionDocument } from "./actionDocument";
import { actionSequenceFromTimelineDraft } from "./actionPersistence";
import { createActionProject, parseActionImport } from "./actionProject";

const clip = {
  schema: "animaPoseClip/1.0",
  id: "wave",
  name: "Wave",
  role: "motion",
  duration: 1,
  basePose: "relaxedRest",
  mutedProceduralLayers: ["cursorLookAt", "sway", "futureLayer"],
  generator: { tool: "animama-animation", source: "wave.motion.json" },
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
    fallbackBasePose: "relaxedRest",
  });

describe("clip field preservation", () => {
  it("parses layer mutes and keeps unknown top-level fields", () => {
    const parsed = parseAnimaPoseClip(clip);
    // Ids follow the canonical layer order; unknown ids are ignored.
    expect(parsed.mutedProceduralLayers).toEqual(["sway", "cursorLookAt"]);
    expect((parsed as Record<string, unknown>).generator).toEqual(
      clip.generator,
    );
    expect(parsed.role).toBe("motion");
    expect(() =>
      parseAnimaPoseClip({ ...clip, mutedProceduralLayers: "sway" }),
    ).toThrow();
  });

  it("survives import, editing, save and export in the Gesture creator", () => {
    const imported = parseActionImport(clip, "gesture");
    if (imported.kind !== "clip")
      throw new Error("Expected a bare clip import.");
    const draft = draftOf(imported.sequence);
    expect(draft.mutedProceduralLayers).toEqual(["sway", "cursorLookAt"]);
    const edited = { ...draft, name: "Big Wave", mutedProceduralLayers: [] };

    const saved = actionSequenceFromTimelineDraft(edited, "gesture")!;
    expect(saved).toMatchObject({
      name: "Big Wave",
      role: "motion",
      generator: clip.generator,
    });
    expect(saved).not.toHaveProperty("mutedProceduralLayers");

    const reopened = draftOf(saved);
    const rebuilt = buildAnimaPoseClipFromPoseCreatorDraft(
      { ...reopened, mutedProceduralLayers: ["breathing"] },
      POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
    )!;
    expect(rebuilt).toMatchObject({
      generator: clip.generator,
      role: "motion",
      mutedProceduralLayers: ["breathing"],
    });

    const document = createActionDocument("gesture");
    document.name = "Big Wave";
    document.sequence = rebuilt;
    const project = createActionProject(document);
    const restored = parseActionImport(
      JSON.parse(JSON.stringify(project)),
      "gesture",
    );
    expect(
      restored.kind === "project" && restored.project.sequence,
    ).toMatchObject({
      generator: clip.generator,
      mutedProceduralLayers: ["breathing"],
    });
  });

  it("keeps unknown fields but drops Gesture-only mutes for Reactions", () => {
    const withPlayback = {
      ...clip,
      playback: {
        lifetime: { kind: "whileInteractionPhase", phases: ["talking"] },
      },
    };
    const saved = actionSequenceFromTimelineDraft(
      draftOf(withPlayback),
      "reaction",
    );
    expect(saved).toMatchObject({
      generator: clip.generator,
      playback: withPlayback.playback,
    });
    expect(saved).not.toHaveProperty("mutedProceduralLayers");
  });

  it("keeps playback lifetimes that the editor does not model", () => {
    const withPlayback = {
      ...clip,
      playback: {
        lifetime: { kind: "whileInteractionPhase", phases: ["talking"] },
      },
    };
    const saved = actionSequenceFromTimelineDraft(
      draftOf(withPlayback),
      "gesture",
    );
    expect(saved).toMatchObject({ playback: withPlayback.playback });
  });
});
