import { describe, expect, it } from "vitest";

import type { ParticleVFXCatalogEntry } from "@/lib/avatar";
import {
  createDefaultPoseCreatorClipDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  createPoseCreatorClipParticleVFXEventDraft,
  formatPoseCreatorClipJsonForExport,
  patchPoseCreatorClipEventDraft,
  validatePoseCreatorClipDraft,
  type PoseCreatorClipDraft,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";

const PARTICLE_DEFAULTS = {
  defaultAnchor: "head",
  defaultDurationSec: 2,
  defaultTransform: {
    offset: { x: 0, y: 0.22, z: 0 },
    depthOffset: 0,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 0.16, y: 0.16, z: 0.16 },
  },
} satisfies Pick<
  ParticleVFXCatalogEntry,
  "defaultAnchor" | "defaultDurationSec" | "defaultTransform"
>;

function createReadyClipDraft(
  overrides: Partial<PoseCreatorClipDraft> = {},
): PoseCreatorClipDraft {
  return {
    ...createDefaultPoseCreatorClipDraft("relaxed-rest"),
    id: "particle-authoring",
    name: "Particle Authoring",
    duration: 2,
    poses: {
      rest: {
        expressions: {
          happy: 0,
        },
      },
    },
    keyframes: [
      {
        id: "keyframe_1",
        time: 0,
        pose: "rest",
      },
    ],
    validationIssues: [],
    ...overrides,
  };
}

describe("pose creator particle VFX authoring", () => {
  it("creates particle events from catalog defaults", () => {
    const draft = createReadyClipDraft();
    const event = createPoseCreatorClipParticleVFXEventDraft(
      draft,
      "cartoon-bang",
      0.35,
      PARTICLE_DEFAULTS,
    );

    expect(event).toMatchObject({
      time: 0.35,
      kind: "particle_vfx",
      effectId: "cartoon-bang",
      anchor: "head",
      duration: 2,
      followAnchor: true,
      transform: {
        offset: { x: 0, y: 0.22, z: 0 },
        depthOffset: 0,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.16, y: 0.16, z: 0.16 },
      },
    });
  });

  it("patches particle anchor, follow behavior, and transform fields", () => {
    const draft = createReadyClipDraft();
    const event = createPoseCreatorClipParticleVFXEventDraft(
      draft,
      "cartoon-bang",
      0,
      PARTICLE_DEFAULTS,
    );

    const patched = patchPoseCreatorClipEventDraft(
      event,
      {
        anchor: "leftHand",
        followAnchor: false,
        transform: {
          offset: { x: 0.15 },
          depthOffset: -0.2,
          rotation: { z: 0.75 },
          scale: { x: 0.5 },
        },
      },
      draft.duration,
    );

    expect(patched).toMatchObject({
      kind: "particle_vfx",
      anchor: "leftHand",
      followAnchor: false,
      transform: {
        offset: { x: 0.15, y: 0.22, z: 0 },
        depthOffset: -0.2,
        rotation: { x: 0, y: 0, z: 0.75 },
        scale: { x: 0.5, y: 0.16, z: 0.16 },
      },
    });
  });

  it("reports missing particle catalog ids during draft validation", () => {
    const draft = createReadyClipDraft({
      events: [
        {
          id: "event_1",
          time: 0,
          kind: "particle_vfx",
          effectId: "missing-particle",
        },
      ],
    });

    expect(
      validatePoseCreatorClipDraft(draft, {
        eventCatalogRefs: {
          particleVFXIds: ["cartoon-bang"],
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "unknown-particle-vfx-id",
        target: "event:event_1",
      }),
    );
  });

  it("preserves particle events through export and import", () => {
    const draft = createReadyClipDraft();
    const particleEvent = patchPoseCreatorClipEventDraft(
      createPoseCreatorClipParticleVFXEventDraft(
        draft,
        "cartoon-bang",
        0.25,
        PARTICLE_DEFAULTS,
      ),
      {
        anchor: "rightHand",
        followAnchor: false,
        transform: {
          offset: { x: -0.1, y: 0.3 },
          depthOffset: 0.4,
        },
      },
      draft.duration,
    );
    const draftWithEvent = createReadyClipDraft({
      events: [particleEvent],
    });

    const exportedJson = formatPoseCreatorClipJsonForExport(draftWithEvent, {
      mode: "referenced",
    });
    expect(exportedJson).not.toBeNull();

    const importedDraft = createPoseCreatorClipDraftFromAnimaPoseClip(
      JSON.parse(exportedJson ?? "{}") as unknown,
      {
        fallbackBasePose: "relaxed-rest",
      },
    );

    expect(importedDraft.events).toHaveLength(1);
    expect(importedDraft.events[0]).toMatchObject({
      kind: "particle_vfx",
      effectId: "cartoon-bang",
      anchor: "rightHand",
      followAnchor: false,
      transform: {
        offset: { x: -0.1, y: 0.3, z: 0 },
        depthOffset: 0.4,
        scale: { x: 0.16, y: 0.16, z: 0.16 },
      },
    });
  });
});
