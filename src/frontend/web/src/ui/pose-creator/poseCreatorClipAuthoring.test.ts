import { describe, expect, it } from "vitest";

import {
  createDefaultPoseCreatorClipDraft,
  createPoseCreatorClipAvatarVFXEventDraft,
  createPoseCreatorClipSceneVFXEventDraft,
  createPoseCreatorClipParticleVFXEventDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  buildPoseCreatorClipForExport,
  createUniquePoseCreatorClipName,
  validatePoseCreatorClipDraft,
  isPoseCreatorBaseKeyframe,
  patchPoseCreatorClipEventDraft,
} from "./poseCreatorClipAuthoring";

describe("createUniquePoseCreatorClipName", () => {
  it("allows the first authored pose after zero when Start base is off", () => {
    const draft = createDefaultPoseCreatorClipDraft("relaxedRest");
    draft.poses = { smile: { expressions: { happy: 0.5 } } };
    draft.keyframes = [{ id: "late", pose: "smile", time: 1 }];
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
  });

  it("leaves a new clip name empty so New Clip remains a placeholder", () => {
    const draft = createDefaultPoseCreatorClipDraft("relaxedRest");
    expect(draft.name).toBe("");
    expect(
      draft.validationIssues.some((issue) => issue.target === "name"),
    ).toBe(false);
  });

  it("uses New Clip when the name is available", () => {
    expect(createUniquePoseCreatorClipName(["Wave", "Jump"])).toBe("New Clip");
  });

  it("fills the first case-insensitive numbered gap", () => {
    expect(
      createUniquePoseCreatorClipName([
        "new clip",
        "New Clip (1)",
        "New Clip (3)",
      ]),
    ).toBe("New Clip (2)");
  });
});

describe("standalone clip hydration", () => {
  it.each([true, false])(
    "preserves saved endpoint choices: enabled=%s",
    (enabled) => {
      const draft = createPoseCreatorClipDraftFromAnimaPoseClip(
        {
          schema: "animaPoseClip/1.0",
          id: "saved",
          name: "Saved",
          duration: 2,
          basePose: "relaxedRest",
          poses: {
            base: { ref: "relaxedRest" },
            middle: { expressions: { happy: 0.5 } },
          },
          poseKeyframes: [
            ...(enabled ? [{ time: 0, pose: "base" }] : []),
            { time: 1, pose: "middle" },
            ...(enabled ? [{ time: 2, pose: "base" }] : []),
          ],
        },
        { fallbackBasePose: "relaxedRest" },
      );
      expect(
        draft.keyframes.filter((frame) =>
          isPoseCreatorBaseKeyframe(draft, frame),
        ),
      ).toHaveLength(enabled ? 2 : 0);
    },
  );

  it("retains omitted base across referenced and baked export despite a caller fallback", () => {
    const input = {
      schema: "animaPoseClip/1.0",
      id: "copied",
      name: "Copied",
      duration: 1,
      poses: { first: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "first" }],
    };
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(input, {
      fallbackBasePose: "relaxedRest",
    });
    expect(draft.basePose).toBe("");
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
    for (const mode of ["referenced", "baked"] as const) {
      const exported = buildPoseCreatorClipForExport(draft, {
        mode,
        resolvePose: () => {
          throw new Error("No external pose should be needed");
        },
      });
      expect(exported?.basePose).toBeUndefined();
      expect(exported?.poses).toEqual(input.poses);
    }
  });
});

describe("accompanying audio authoring", () => {
  it("preserves per-event suppression through edits, export and reopen", () => {
    const input = {
      schema: "animaPoseClip/1.0",
      id: "audio",
      name: "Audio",
      duration: 2,
      poses: { first: { expressions: { happy: 0.5 } } },
      poseKeyframes: [{ time: 0, pose: "first" }],
      events: [
        {
          id: "avatar",
          kind: "avatar_vfx",
          effectId: "sparkles",
          time: 0,
          playAccompanyingSound: false,
        },
        {
          id: "scene",
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "stars",
          time: 0,
          playAccompanyingSound: false,
        },
      ],
    };
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(input, {
      fallbackBasePose: "relaxedRest",
    });
    draft.events = draft.events.map((event) =>
      patchPoseCreatorClipEventDraft(event, { time: 0.5 }, 2),
    );
    const exported = buildPoseCreatorClipForExport(draft, {
      mode: "referenced",
    });
    const reopened = createPoseCreatorClipDraftFromAnimaPoseClip(
      JSON.parse(JSON.stringify(exported)),
      { fallbackBasePose: "relaxedRest" },
    );
    expect(reopened.events).toHaveLength(2);
    for (const event of reopened.events)
      expect(event).toMatchObject({ time: 0.5, playAccompanyingSound: false });
    expect(
      patchPoseCreatorClipEventDraft(
        reopened.events[0]!,
        { playAccompanyingSound: true },
        2,
      ),
    ).toMatchObject({ playAccompanyingSound: true });
  });
});

describe("event-only authoring", () => {
  it("exports and reopens effects without requiring an unrelated pose", () => {
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(
      {
        schema: "animaPoseClip/1.0",
        id: "sound-only",
        name: "Sound only",
        duration: 1,
        poses: {},
        poseKeyframes: [],
        events: [{ id: "chime", kind: "sfx", cueId: "chime", time: 0 }],
      },
      { fallbackBasePose: "relaxedRest" },
    );
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
    const exported = buildPoseCreatorClipForExport(draft, {
      mode: "referenced",
    });
    expect(exported).toMatchObject({
      poses: {},
      poseKeyframes: [],
      events: [{ id: "chime", kind: "sfx", cueId: "chime", time: 0 }],
    });
    expect(
      createPoseCreatorClipDraftFromAnimaPoseClip(exported, {
        fallbackBasePose: "relaxedRest",
      }).events,
    ).toHaveLength(1);
    draft.events = [];
    expect(
      validatePoseCreatorClipDraft(draft).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
    expect(
      buildPoseCreatorClipForExport(draft, { mode: "referenced" }),
    ).toBeNull();
  });
});

describe("VFX event end ownership", () => {
  it("preserves Start while switching between a duration and Action-owned end", () => {
    const timed = patchPoseCreatorClipEventDraft(
      {
        id: "effect",
        time: 0.5,
        kind: "avatar_vfx",
        effectId: "eyes",
        duration: 1,
      },
      { duration: null },
      3,
    );
    expect(timed).toMatchObject({ time: 0.5 });
    expect(timed).not.toHaveProperty("duration");
    expect(
      patchPoseCreatorClipEventDraft(timed, { duration: 0.75 }, 3),
    ).toMatchObject({ time: 0.5, duration: 0.75 });
  });
});

it("defaults every new VFX event to ending with its Action", () => {
  const draft = createDefaultPoseCreatorClipDraft("relaxedRest");
  const events = [
    createPoseCreatorClipAvatarVFXEventDraft(draft, "eyes", 0),
    createPoseCreatorClipSceneVFXEventDraft(draft, "focus_lines", "focus", 0),
    createPoseCreatorClipParticleVFXEventDraft(draft, "hearts", 0),
    createPoseCreatorClipParticleVFXEventDraft(draft, "hearts", 0, {
      defaultAnchor: "head",
      defaultDurationSec: 5,
      defaultTransform: {
        offset: { x: 0, y: 0, z: 0 },
        depthOffset: 0,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
  ];
  for (const event of events) expect(event).not.toHaveProperty("duration");
});
