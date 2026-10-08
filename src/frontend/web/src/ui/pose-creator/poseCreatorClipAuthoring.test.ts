import { describe, expect, it } from "vitest";

import { unsupportedAnimaPoseClipFormatMessage } from "@/lib/avatar/poses/animaPoseClip";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  createDefaultPoseCreatorClipDraft,
  createPoseCreatorClipAvatarVFXEventDraft,
  createPoseCreatorClipSceneVFXEventDraft,
  createPoseCreatorClipParticleVFXEventDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  createUniquePoseCreatorClipName,
  formatPoseCreatorClipJsonForExport,
  validatePoseCreatorClipDraft,
  isPoseCreatorBaseKeyframe,
  patchPoseCreatorClipEventDraft,
} from "./poseCreatorClipAuthoring";
import { insertPoseCreatorBeat } from "./poseCreatorClipMotion";

describe("createUniquePoseCreatorClipName", () => {
  it("allows the first authored pose after zero when Start base is off", () => {
    const draft = insertPoseCreatorBeat(
      createDefaultPoseCreatorClipDraft("relaxedRest"),
      { timeSec: 1, label: "Smile", pose: { expressions: { happy: 0.5 } } },
      null,
    );
    expect(draft.keyframes.map(({ time }) => time)).toEqual([1]);
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

const SMILE = {
  beats: [{ id: "smile", label: "Smile", time: 0 }],
  expressions: { happy: [{ v: 0.5, beat: "smile" }] },
};

describe("standalone clip hydration", () => {
  it.each([true, false])(
    "preserves saved endpoint choices: enabled=%s",
    (enabled) => {
      const draft = createPoseCreatorClipDraftFromAnimaPoseClip(
        {
          schema: "animaPoseClip/2.0",
          id: "saved",
          name: "Saved",
          duration: 2,
          basePose: "relaxedRest",
          beats: [
            ...(enabled ? [{ id: "start", label: "Base", time: 0 }] : []),
            { id: "middle", label: "Middle", time: 1 },
            ...(enabled ? [{ id: "end", label: "Base", time: 2 }] : []),
          ],
          expressions: { happy: [{ v: 0.5, beat: "middle" }] },
        },
        { fallbackBasePose: "relaxedRest" },
      );
      expect(draft.keyframes.filter(isPoseCreatorBaseKeyframe)).toHaveLength(
        enabled ? 2 : 0,
      );
    },
  );

  it("retains an omitted base pose despite a caller fallback", () => {
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(
      {
        schema: "animaPoseClip/2.0",
        id: "copied",
        name: "Copied",
        duration: 1,
        ...SMILE,
      },
      { fallbackBasePose: "relaxedRest" },
    );
    expect(draft.basePose).toBe("");
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
    const exported = buildAnimaPoseClipFromPoseCreatorDraft(draft);
    expect(exported?.basePose).toBeUndefined();
    // The expression is kept by value, with no base posture added.
    expect(exported).toMatchObject({
      schema: "animaPoseClip/2.0",
      beats: [{ time: 0 }],
      expressions: { happy: [{ v: 0.5 }] },
    });
    expect(exported).not.toHaveProperty("rotations");
  });

  it.each([
    [
      "animaPoseClip/1.0",
      {
        schema: "animaPoseClip/1.0",
        id: "legacy",
        name: "Legacy",
        duration: 1,
        poses: { first: { expressions: { happy: 0.5 } } },
        poseKeyframes: [{ time: 0, pose: "first" }],
      },
    ],
    ["animaPoseClip/9.0", { schema: "animaPoseClip/9.0", id: "future" }],
  ])(
    "rejects a %s clip with the unsupported-format message",
    (schema, clip) => {
      expect(() =>
        createPoseCreatorClipDraftFromAnimaPoseClip(clip, {
          fallbackBasePose: "relaxedRest",
        }),
      ).toThrow(unsupportedAnimaPoseClipFormatMessage(schema));
    },
  );
});

describe("accompanying audio authoring", () => {
  it("preserves per-event suppression through edits, export and reopen", () => {
    const input = {
      schema: "animaPoseClip/2.0",
      id: "audio",
      name: "Audio",
      duration: 2,
      ...SMILE,
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
    const exported = formatPoseCreatorClipJsonForExport(draft);
    const reopened = createPoseCreatorClipDraftFromAnimaPoseClip(
      JSON.parse(exported!),
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
        schema: "animaPoseClip/2.0",
        id: "sound-only",
        name: "Sound only",
        duration: 1,
        beats: [],
        events: [{ id: "chime", kind: "sfx", cueId: "chime", time: 0 }],
      },
      { fallbackBasePose: "relaxedRest" },
    );
    expect(validatePoseCreatorClipDraft(draft)).toEqual([]);
    const exported = buildAnimaPoseClipFromPoseCreatorDraft(draft);
    expect(exported).toMatchObject({
      schema: "animaPoseClip/2.0",
      beats: [],
      events: [{ id: "chime", kind: "sfx", cueId: "chime", time: 0 }],
    });
    expect(
      createPoseCreatorClipDraftFromAnimaPoseClip(exported, {
        fallbackBasePose: "relaxedRest",
      }).events,
    ).toHaveLength(1);
    const empty = { ...draft, events: [] };
    expect(
      validatePoseCreatorClipDraft(empty).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
    expect(buildAnimaPoseClipFromPoseCreatorDraft(empty)).toBeNull();
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

describe("Avatar Effect event fades", () => {
  const timed = {
    id: "effect",
    time: 0.5,
    kind: "avatar_vfx" as const,
    effectId: "eyes",
    duration: 2,
  };

  it("writes Fade in and Fade out into the intensity envelope", () => {
    const faded = patchPoseCreatorClipEventDraft(timed, { fadeIn: 0.25 }, 3);
    expect(faded).toMatchObject({
      envelope: { intensity: { fadeIn: 0.25, fadeOut: 0 } },
    });
    const both = patchPoseCreatorClipEventDraft(faded, { fadeOut: 5 }, 3);
    // A fade cannot outlast its event.
    expect(both).toMatchObject({
      envelope: { intensity: { fadeIn: 0.25, fadeOut: 2 } },
    });
    expect(
      patchPoseCreatorClipEventDraft(both, { fadeIn: 0, fadeOut: 0 }, 3),
    ).not.toHaveProperty("envelope");
  });

  it("removes the fades when End switches to With Action", () => {
    const faded = patchPoseCreatorClipEventDraft(
      timed,
      { fadeIn: 0.5, fadeOut: 0.5 },
      3,
    );
    const withAction = patchPoseCreatorClipEventDraft(
      faded,
      { duration: null },
      3,
    );
    expect(withAction).not.toHaveProperty("envelope");
    expect(withAction).not.toHaveProperty("duration");
  });

  it("re-clamps the fades when the duration shortens", () => {
    const faded = patchPoseCreatorClipEventDraft(
      timed,
      { fadeIn: 1.5, fadeOut: 2 },
      3,
    );
    expect(
      patchPoseCreatorClipEventDraft(faded, { duration: 1 }, 3),
    ).toMatchObject({
      duration: 1,
      envelope: { intensity: { fadeIn: 1, fadeOut: 1 } },
    });
  });

  it("ignores fades for events that end with their Action", () => {
    const withAction = patchPoseCreatorClipEventDraft(
      timed,
      { duration: null },
      3,
    );
    expect(
      patchPoseCreatorClipEventDraft(withAction, { fadeIn: 1 }, 3),
    ).not.toHaveProperty("envelope");
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
