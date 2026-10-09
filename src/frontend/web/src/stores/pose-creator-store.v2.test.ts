import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseAnimaPose, type Avatar } from "@/lib/avatar";
import { loadTestAvatar } from "@/lib/avatar/motion-authoring/testing/includedAvatars";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import {
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
} from "@/lib/avatar/poses/anatomy/anatomy";
import {
  HAND_SEGMENTS,
  adjustHandQuaternion,
} from "@/lib/avatar/poses/anatomy/handPresets";
import { createHandInteractionController } from "@/ui/pose-creator/poseCreatorHandInteraction";
import {
  validateAnimaPoseClipV2,
  type AnimaPoseClipV2,
} from "@/lib/avatar/poses/animaPoseClip/schemaV2";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  resolvePoseCreatorCatalogPose,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import {
  POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  usePoseCreatorStore,
} from "./pose-creator-store";

const example = (name: string): AnimaPoseClipV2 => {
  const result = validateAnimaPoseClipV2(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            `../../../../../content/included/gestures/${name}/${name}.json`,
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { ...result.clip, generator: { tool: "test" } } as AnimaPoseClipV2;
};

const state = () => usePoseCreatorStore.getState();
const built = () => {
  const clip = buildAnimaPoseClipFromPoseCreatorDraft(
    state().clipDraft,
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
  if (!clip || clip.schema !== "animaPoseClip/2.0")
    throw new Error("expected a 2.0 clip");
  return clip;
};
const beat = (clip: AnimaPoseClipV2, id: string) =>
  clip.beats.find((candidate) => candidate.id === id)!;

describe("pose creator store with an animaPoseClip/2.0 draft", () => {
  beforeEach(() => {
    state().resetWorkspace();
    expect(state().hydrateClipDocument(example("hearty-laugh"))).toBe(true);
  });

  it("shows beats as labelled keyframes with their detail", () => {
    const { keyframes, motion } = state().clipDraft;
    expect(motion?.beats).toHaveLength(7);
    expect(keyframes.map(({ label }) => label)).toEqual([
      "Start",
      "Anticipate",
      "Burst",
      "Laughing",
      "Recover",
      "Rebound",
      "Settle",
    ]);
    expect(keyframes.find(({ id }) => id === "burst")?.detail).toMatchObject({
      channels: expect.any(Number),
    });
  });

  it("round-trips the clip, unknown fields included", () => {
    const original = example("hearty-laugh");
    const clip = built();
    expect(clip).toMatchObject({
      generator: { tool: "test" },
      beats: original.beats,
      joints: original.joints,
      hands: original.hands,
      expressions: original.expressions,
      plantFeet: true,
    });
  });

  it("retimes a beat with its detail, then undoes it", () => {
    const before = built();
    state().moveClipKeyframe("laughing", 1.3);
    const moved = built();
    expect(beat(moved, "laughing").time).toBe(1.3);
    expect(moved.joints!.chest).not.toEqual(before.joints!.chest);
    expect(
      state().clipDraft.keyframes.find(({ id }) => id === "laughing"),
    ).toMatchObject({ time: 1.3 });
    state().undoClip();
    expect(built()).toEqual(before);
  });

  it("relabels, eases and deletes the selected beat", () => {
    state().selectClipKeyframe("recover");
    state().updateSelectedClipKeyframe({ label: "Catch breath" });
    state().updateSelectedClipKeyframe({ ease: "linear" });
    expect(beat(built(), "recover")).toMatchObject({
      label: "Catch breath",
      ease: "linear",
    });
    state().deleteSelectedClipKeyframe();
    expect(built().beats.some(({ id }) => id === "recover")).toBe(false);
    expect(JSON.stringify(built())).not.toContain('"recover"');
  });

  it("applies a Pose tab edit to the beat, re-targeting its detail", () => {
    const clip = built();
    const sample = createAnimaPoseClipProgram(clip, {
      resolvePose: resolvePoseCreatorCatalogPose,
    }).sample(beat(clip, "burst").time).sample;
    const turned = new Quaternion(...sample.humanoid!.head!.rotation!)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2))
      .toArray() as [number, number, number, number];
    state().selectClipKeyframe("burst");
    state().beginClipInlinePoseEdit({
      alias: "burst",
      keyframeId: "burst",
      originalPose: { humanoid: sample.humanoid },
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "",
    });
    state().commitClipInlinePoseEdit(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "edit",
        name: "Edit",
        humanoid: { ...sample.humanoid, head: { rotation: turned } },
        expressions: sample.expressions,
      }),
    );
    const edited = built();
    const head = new Quaternion(
      ...createAnimaPoseClipProgram(edited, {
        resolvePose: resolvePoseCreatorCatalogPose,
      }).sample(beat(edited, "burst").time).sample.humanoid!.head!.rotation!,
    );
    expect(head.angleTo(new Quaternion(...turned))).toBeLessThan(1e-3);
    // Joints the edit left alone keep their keys.
    expect(edited.joints!.rightUpperArm).toEqual(clip.joints!.rightUpperArm);
  });

  it("returns bones and expressions a Pose tab edit reset to the base", () => {
    const clip = built();
    const time = beat(clip, "burst").time;
    const sampleOf = (source: AnimaPoseClipV2) =>
      createAnimaPoseClipProgram(source, {
        resolvePose: resolvePoseCreatorCatalogPose,
      }).sample(time).sample;
    const sample = sampleOf(clip);
    expect(Object.values(sample.expressions ?? {}).some((v) => v > 0.1)).toBe(
      true,
    );
    const { head, ...rest } = sample.humanoid!;
    expect(head?.rotation).toBeDefined();
    state().selectClipKeyframe("burst");
    state().beginClipInlinePoseEdit({
      alias: "burst",
      keyframeId: "burst",
      originalPose: { humanoid: sample.humanoid },
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "",
    });
    // Reset bone (head) and Clear all expressions omit them from the pose.
    state().commitClipInlinePoseEdit(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "edit",
        name: "Edit",
        humanoid: rest,
      }),
    );
    const edited = sampleOf(built());
    const base =
      resolvePoseCreatorCatalogPose("relaxedRest")?.humanoid?.head?.rotation ??
      ([0, 0, 0, 1] as const);
    expect(
      new Quaternion(...edited.humanoid!.head!.rotation!).angleTo(
        new Quaternion(...base),
      ),
    ).toBeLessThan(1e-3);
    for (const value of Object.values(edited.expressions ?? {}))
      expect(value).toBeCloseTo(0, 3);
  });

  it("captures a beat at the playhead and adds a Library Pose as a beat", () => {
    state().setClipCurrentTime(1.0);
    state().captureClipPoseAtPlayhead();
    expect(built().beats.find(({ time }) => time === 1)).toMatchObject({
      label: "Captured",
    });
    const alias = state().addPoseToClip(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "smile",
        name: "Smile",
        expressions: { happy: 1 },
      }),
      "Big smile",
      { timeSec: 3.2 },
    );
    expect(alias).toBe(state().clipDraft.selectedKeyframeId);
    expect(beat(built(), alias!)).toMatchObject({ label: "Big smile" });
  });

  it("adds and removes a base beat at the clip's end", () => {
    state().setClipBaseEndpoint("end", true);
    const end = built().beats.at(-1)!;
    expect(end).toMatchObject({ label: "Base", time: built().duration });
    state().setClipBaseEndpoint("end", false);
    expect(built().beats.at(-1)!.label).not.toBe("Base");
  });

  it("re-poses base beats when the base pose changes", () => {
    state().setClipBaseEndpoint("end", true);
    state().updateClipDraft({ basePose: "hands-on-hips" });
    const clip = built();
    expect(clip.basePose).toBe("hands-on-hips");
    const end = createAnimaPoseClipProgram(clip, {
      resolvePose: resolvePoseCreatorCatalogPose,
    }).sample(clip.duration).sample.humanoid!;
    const handsOnHips =
      resolvePoseCreatorCatalogPose("hands-on-hips")!.humanoid!;
    for (const bone of ["leftUpperArm", "rightUpperArm", "spine"] as const) {
      const expected = handsOnHips[bone]?.rotation ?? [0, 0, 0, 1];
      expect(
        new Quaternion(...end[bone]!.rotation!).angleTo(
          new Quaternion(...expected),
        ),
      ).toBeLessThan(2e-3);
    }
  });
});

describe("pose creator store with a whole-clip contact", () => {
  it("stays saveable after the loop is shortened", () => {
    state().resetWorkspace();
    expect(state().hydrateClipDocument(example("arms-crossed"))).toBe(true);
    state().moveClipKeyframe("end", 2.0);
    state().updateClipDraft({ duration: 2.0 });
    const clip = built();
    expect(clip.duration).toBe(2);
    expect(clip.contacts?.[0]).toMatchObject({ from: 0, to: 2 });
  });
});

describe("pose creator store with a 2.0 Reaction draft", () => {
  it("sets the expressions of the beat at the playhead", () => {
    state().resetWorkspace();
    state().hydrateClipDocument({
      schema: "animaPoseClip/2.0",
      id: "joy",
      name: "Joy",
      duration: 1.2,
      beats: [{ id: "start", label: "Start", time: 0 }],
      expressions: { happy: [{ beat: "start", v: 1 }] },
    });
    state().setClipCurrentTime(0.3);
    state().setClipExpressionsAtPlayhead({ angry: 1 });
    const clip = built();
    expect(clip.beats).toHaveLength(2);
    const sample = createAnimaPoseClipProgram(clip, {
      resolvePose: () => null,
    }).sample(0.3).sample.expressions!;
    expect(sample.angry).toBeCloseTo(1);
    expect(sample.happy).toBeCloseTo(0);
  });
});

describe("pose creator store with hand keys", () => {
  let vrm: VRM;
  let controller: ReturnType<typeof createHandInteractionController>;
  beforeAll(async () => {
    vrm = await loadTestAvatar("AvatarSample_A_1_New");
  });
  /** Right-hand keys at each beat (a pinch at "b"); the left hand has none. */
  const handClip = (): AnimaPoseClipV2 => ({
    schema: "animaPoseClip/2.0",
    id: "hands",
    name: "Hands",
    duration: 3,
    basePose: "relaxedRest",
    beats: [
      { id: "a", label: "A", time: 0 },
      { id: "b", label: "B", time: 1 },
      { id: "c", label: "C", time: 2 },
    ],
    joints: {
      head: {
        flexion: [
          { beat: "a", v: 0 },
          { beat: "b", v: 10 },
          { beat: "c", v: 0 },
        ],
      },
    },
    hands: {
      right: [
        { beat: "a", preset: "relaxed" },
        { beat: "b", preset: "pinch", curl: 5 },
        { beat: "c", preset: "open-together", spread: 8 },
      ],
    },
  });
  const program = (clip: AnimaPoseClipV2) =>
    createAnimaPoseClipProgram(clip, {
      vrm,
      resolvePose: resolvePoseCreatorCatalogPose,
    });
  const toQuaternion = (degrees: { x: number; y: number; z: number }) =>
    new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(degrees.x),
        MathUtils.degToRad(degrees.y),
        MathUtils.degToRad(degrees.z),
        "XYZ",
      ),
    );
  const toDegrees = (rotation: Quaternion) => {
    const euler = new Euler().setFromQuaternion(rotation, "XYZ");
    return {
      x: MathUtils.radToDeg(euler.x),
      y: MathUtils.radToDeg(euler.y),
      z: MathUtils.radToDeg(euler.z),
    };
  };
  const fingerBone = /^(left|right)(Thumb|Index|Middle|Ring|Little)/;
  /** Open the beat's key pose for editing, its fingers as drafts. */
  const editBeat = (beatId: string) => {
    const clip = built();
    const sample = program(clip).sample(beat(clip, beatId).time).sample;
    const boneDrafts = Object.fromEntries(
      Object.entries(sample.humanoid!)
        .filter(([bone]) => fingerBone.test(bone))
        .map(([bone, transform]) => [
          bone,
          {
            baseQuaternion: [0, 0, 0, 1] as [number, number, number, number],
            rotationDegrees: toDegrees(new Quaternion(...transform!.rotation!)),
          },
        ]),
    );
    state().selectClipKeyframe(beatId);
    state().beginClipInlinePoseEdit({
      alias: beatId,
      keyframeId: beatId,
      originalPose: { humanoid: sample.humanoid },
      boneDrafts,
      expressionDrafts: {},
      draftName: "",
    });
    return sample.humanoid!;
  };
  /** Apply the inline edit: the key pose with the drafted bones. */
  const commit = (shown: VRMPose) => {
    const humanoid: VRMPose = { ...shown };
    for (const [bone, draft] of Object.entries(state().boneDrafts))
      humanoid[bone as VRMHumanBoneName] = {
        rotation: toQuaternion(draft.rotationDegrees).toArray() as [
          number,
          number,
          number,
          number,
        ],
      };
    state().commitClipInlinePoseEdit(
      parseAnimaPose({
        schema: "animaPose/1.0",
        id: "edit",
        name: "Edit",
        humanoid,
      }),
    );
    return humanoid;
  };
  /** Whether the saved clip plays the committed fingers at a beat. */
  const expectPlays = (
    humanoid: VRMPose,
    beatId: string,
    side: string,
    tolerance = 0.01,
    bones?: readonly string[],
  ) => {
    const clip = built();
    const played = program(clip).sample(beat(clip, beatId).time).sample
      .humanoid!;
    for (const [bone, transform] of Object.entries(humanoid))
      if (
        bone.startsWith(side) &&
        fingerBone.test(bone) &&
        (!bones || bones.includes(bone))
      )
        expect(
          angularDistanceDegrees(
            new Quaternion(...played[bone as VRMHumanBoneName]!.rotation!),
            new Quaternion(...transform!.rotation!),
          ),
          bone,
        ).toBeLessThan(tolerance);
  };
  /** Finger bones with their own joint or rotation tracks. */
  const fingerTracks = () =>
    [
      ...Object.keys(built().joints ?? {}),
      ...Object.keys(built().rotations ?? {}),
    ].filter((bone) => fingerBone.test(bone));
  const allSegments = HAND_SEGMENTS.map(({ id }) => id);
  /** A bone's drafted rotation. */
  const shownOf = (bone: VRMHumanBoneName) =>
    toQuaternion(state().boneDrafts[bone].rotationDegrees);
  /** A Bones-panel or gizmo edit: turn a drafted bone by joint-model degrees. */
  const turnBone = (bone: VRMHumanBoneName, change: Record<string, number>) => {
    const joint = resolveJoint(bone)!;
    const values = decomposeJointRotation(joint, shownOf(bone));
    for (const [name, value] of Object.entries(change)) values[name] += value;
    const turned = composeJointRotation(joint, values);
    state().setBoneDraft(bone, {
      ...state().boneDrafts[bone],
      rotationDegrees: toDegrees(turned),
    });
    return turned;
  };
  const open = (clip: AnimaPoseClipV2) => {
    state().resetWorkspace();
    expect(state().hydrateClipDocument(clip)).toBe(true);
    usePoseCreatorStore.setState({
      activeAvatar: { vrm } as unknown as Avatar,
      loadStatus: "ready",
    });
  };

  beforeEach(() => {
    open(handClip());
    controller = createHandInteractionController();
  });
  afterEach(() => {
    controller.dispose();
    vrm.humanoid.resetNormalizedPose();
  });

  it("writes a preset chosen at a beat as its hand key", () => {
    const original = built();
    const shown = editBeat("b");
    expect(controller.preset("right", "fist")).toBe(true);
    expect(state().clipInlineEdit?.handShapes).toEqual({
      right: { preset: "fist" },
    });
    // The choice is one inline Undo step, shape included.
    state().undoClip();
    expect(state().clipInlineEdit?.handShapes).toBeUndefined();
    state().redoClip();
    expect(state().clipInlineEdit?.handShapes).toEqual({
      right: { preset: "fist" },
    });
    const humanoid = commit(shown);
    const clip = built();
    expect(clip.hands!.right).toEqual([
      original.hands!.right![0],
      { beat: "b", preset: "fist" },
      original.hands!.right![2],
    ]);
    expect(clip.rotations).toBeUndefined();
    expectPlays(humanoid, "b", "right");
    state().undoClip();
    expect(built()).toEqual(original);
  });

  it("curls the whole hand as the key's Curl and some segments as offsets", () => {
    const shown = editBeat("b");
    expect(controller.begin("right", allSegments, "curl")).toBe(true);
    controller.update(10);
    controller.update(20);
    controller.end();
    // The beat's pinch keeps its own Curl of 5.
    expect(state().clipInlineEdit?.handShapes?.right).toEqual({
      preset: "pinch",
      curl: 25,
    });
    expect(state().inlinePoseUndoHistory).toHaveLength(1);
    expect(controller.begin("right", ["indexIntermediate"], "curl")).toBe(true);
    controller.update(-10);
    controller.end();
    expect(state().clipInlineEdit?.handShapes?.right).toEqual({
      preset: "pinch",
      curl: 25,
      fingers: { index: { curl: [0, -10, 0] } },
    });
    const humanoid = commit(shown);
    expect(built().hands!.right![1]).toEqual({
      beat: "b",
      preset: "pinch",
      curl: 25,
      fingers: { index: { curl: [0, -10, 0] } },
    });
    expectPlays(humanoid, "b", "right");
  });

  it("keeps a bone edit through a later Curl", () => {
    const shown = editBeat("b");
    controller.preset("right", "fist");
    const bent = turnBone("rightIndexDistal", { curl: 40 });
    controller.begin("right", allSegments, "curl");
    controller.update(5);
    controller.end();
    // The bend is kept as an offset; the whole hand curls 5 more.
    expect(state().clipInlineEdit?.handShapes?.right).toEqual({
      preset: "fist",
      curl: 5,
      fingers: { index: { curl: [0, 0, 40] } },
    });
    expect(
      angularDistanceDegrees(shownOf("rightIndexDistal"), bent),
    ).toBeCloseTo(5, 3);
    expectPlays(commit(shown), "b", "right");
  });

  it("turns bones a shape does not drive as bones during a Curl", () => {
    const bone: VRMHumanBoneName = "rightIndexIntermediate";
    const keys = (v: number) =>
      (["a", "b", "c"] as const).map((beatId) => ({ beat: beatId, v }));
    // A bone with its own track keeps its twist.
    const tracked = handClip();
    open({
      ...tracked,
      joints: {
        ...tracked.joints,
        [bone]: { twist: keys(20), curl: keys(10) },
      },
    });
    let shown = editBeat("b");
    let before = shownOf(bone);
    controller.begin("right", allSegments, "curl");
    controller.update(5);
    controller.end();
    expect(
      angularDistanceDegrees(
        shownOf(bone),
        adjustHandQuaternion(before, "right", "index", "curl", 5),
      ),
    ).toBeLessThan(1e-4);
    expectPlays(commit(shown), "b", "right");
    expect(built().joints![bone].twist.map(({ v }) => v)).toEqual([
      20,
      expect.closeTo(20, 0),
      20,
    ]);

    // A twist offsets cannot express keeps its turn and gets a track.
    open(handClip());
    shown = editBeat("b");
    turnBone(bone, { twist: 20 });
    before = shownOf(bone);
    controller.begin("right", allSegments, "curl");
    controller.update(5);
    controller.end();
    expect(
      angularDistanceDegrees(
        shownOf(bone),
        adjustHandQuaternion(before, "right", "index", "curl", 5),
      ),
    ).toBeLessThan(1e-4);
    expectPlays(commit(shown), "b", "right");
    const clip = built();
    expect(clip.hands!.right![1]).toMatchObject({
      beat: "b",
      preset: "pinch",
      curl: 10,
    });
    expect(
      Object.values(clip.joints![bone]).map((track) =>
        track.map((key) => key.beat),
      ),
    ).toEqual([
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["a", "b", "c"],
    ]);
    // The key holds the closest offsets for the twisted bone: on this
    // intermediate segment that is its curl, so key and track agree on it;
    // the twist (and splay) only the track can carry.
    const joints = { ...clip.joints };
    delete joints[bone];
    const joint = resolveJoint(bone)!;
    const played = (source: AnimaPoseClipV2) =>
      decomposeJointRotation(
        joint,
        new Quaternion(
          ...program(source).sample(1).sample.humanoid![bone]!.rotation!,
        ),
      );
    const fromTrack = played(clip);
    const fromKey = played({ ...clip, joints });
    expect(fromKey.curl).toBeCloseTo(fromTrack.curl, 1);
    expect(fromTrack.twist - fromKey.twist).toBeCloseTo(20, 0);
  });

  /**
   * Keys `fist` at a and `open-spread` at c: the hand at b is a blend that
   * the nearest key's offsets only approximate (a few degrees).
   */
  const openBlend = () => {
    const clip = handClip();
    open({
      ...clip,
      hands: {
        right: [
          { beat: "a", preset: "fist" },
          { beat: "c", preset: "open-spread" },
        ],
      },
    });
  };
  const blendTolerance = 4.5;

  it("moves only the selected bones when some segments are curled", () => {
    openBlend();
    const shown = editBeat("b");
    const drafts = state().boneDrafts;
    const index = ["Proximal", "Intermediate", "Distal"].map(
      (segment) => `rightIndex${segment}` as VRMHumanBoneName,
    );
    const before = shownOf("rightIndexIntermediate");
    controller.begin(
      "right",
      ["indexProximal", "indexIntermediate", "indexDistal"],
      "curl",
    );
    controller.update(10);
    controller.end();
    for (const [bone, draft] of Object.entries(state().boneDrafts))
      if (!index.includes(bone as VRMHumanBoneName))
        expect(draft, bone).toEqual(drafts[bone]);
    expect(
      angularDistanceDegrees(shownOf("rightIndexIntermediate"), before),
    ).toBeCloseTo(10, 3);
    // The curl is kept as offsets: no finger tracks, and the curled finger
    // plays as shown; the others hold the blend as closely as offsets can.
    const humanoid = commit(shown);
    expect(fingerTracks()).toEqual([]);
    expectPlays(humanoid, "b", "right", 0.01, index);
    expectPlays(humanoid, "b", "right", blendTolerance);
  });

  it.each(["curl", "spread"] as const)(
    "keeps a whole-hand %s between two different keys as the key's shape",
    (adjustment) => {
      openBlend();
      const shown = editBeat("b");
      controller.begin("right", allSegments, adjustment);
      controller.update(5);
      controller.end();
      expect(state().clipInlineEdit?.handShapes?.right).toMatchObject({
        preset: "fist",
        [adjustment]: 5,
      });
      const humanoid = commit(shown);
      expect(fingerTracks()).toEqual([]);
      // Every finger the shape drives plays exactly as shown.
      expectPlays(humanoid, "b", "right");
    },
  );

  it("keeps a Bones curl between two keys as offsets and a twist as a track", () => {
    openBlend();
    let shown = editBeat("b");
    turnBone("rightIndexProximal", { curl: 10 });
    let humanoid = commit(shown);
    expect(fingerTracks()).toEqual([]);
    expectPlays(humanoid, "b", "right", blendTolerance);

    openBlend();
    shown = editBeat("b");
    turnBone("rightIndexIntermediate", { twist: 15 });
    humanoid = commit(shown);
    expect(fingerTracks()).toEqual(["rightIndexIntermediate"]);
    expectPlays(humanoid, "b", "right", 0.01, ["rightIndexIntermediate"]);
    expectPlays(humanoid, "b", "right", blendTolerance);
  });

  it("leaves the edit unchanged when a Curl returns to zero", () => {
    editBeat("b");
    const drafts = state().boneDrafts;
    controller.begin("right", allSegments, "curl");
    controller.update(30);
    controller.update(0);
    controller.end();
    expect(state().clipInlineEdit?.handShapes).toBeUndefined();
    expect(state().boneDrafts).toEqual(drafts);
    expect(state().inlinePoseUndoHistory).toHaveLength(0);
  });

  it("turns bones of a hand without keys until a preset starts its keys", () => {
    const shown = editBeat("b");
    controller.begin("left", ["indexProximal"], "curl");
    controller.update(20);
    controller.end();
    expect(state().clipInlineEdit?.handShapes).toBeUndefined();
    commit(shown);
    expect(built().hands!.left).toBeUndefined();
    expect(
      built().rotations!.leftIndexProximal!.map((key) => key.beat),
    ).toEqual(["a", "b", "c"]);

    state().undoClip();
    const again = editBeat("b");
    controller.preset("left", "peace");
    const humanoid = commit(again);
    expect(built().hands!.left).toEqual([
      { beat: "a", preset: "relaxed" },
      { beat: "b", preset: "peace" },
      { beat: "c", preset: "relaxed" },
    ]);
    expectPlays(humanoid, "b", "left");
  });

  it("forgets chosen shapes when every bone is reset", () => {
    editBeat("b");
    controller.preset("both", "ok");
    expect(Object.keys(state().clipInlineEdit!.handShapes!)).toEqual([
      "left",
      "right",
    ]);
    state().clearBoneDrafts();
    expect(state().clipInlineEdit?.handShapes).toBeUndefined();
    state().undoClip();
    expect(Object.keys(state().clipInlineEdit!.handShapes!)).toEqual([
      "left",
      "right",
    ]);
  });
});
