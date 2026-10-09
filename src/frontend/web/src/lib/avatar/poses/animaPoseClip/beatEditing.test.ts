import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { loadTestAvatar } from "../../motion-authoring/testing/includedAvatars";
import {
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
} from "../anatomy/anatomy";
import { handShapeRotations, type HandShape } from "../anatomy/handPresets";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../catalog";
import {
  beatDetailSummary,
  beatHasDetail,
  beatKeyPose,
  deleteBeat,
  detachBasePose,
  fitContactsToClip,
  insertBeat,
  retimeBeat,
  setBeatEase,
  setBeatLabel,
  setBeatPose,
  type BeatEditContext,
} from "./beatEditing";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import {
  validateAnimaPoseClipV2,
  type AnimaPoseClipContact,
  type AnimaPoseClipV2,
} from "./schemaV2";

const resolvePose = (id: string) => getResolvedAvatarPose(id);
const example = (name: string): AnimaPoseClipV2 => {
  const result = validateAnimaPoseClipV2(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            `../../../../../../../../content/included/gestures/${name}/${name}.json`,
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.clip;
};

let a1: VRM;
let context: BeatEditContext;
beforeAll(async () => {
  a1 = await loadTestAvatar("AvatarSample_A_1_New");
  context = { vrm: a1, resolvePose };
});

const valid = (clip: AnimaPoseClipV2) => {
  const result = validateAnimaPoseClipV2(clip);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.clip;
};
const beat = (clip: AnimaPoseClipV2, id: string) =>
  clip.beats.find((candidate) => candidate.id === id)!;
/** Absolute key times of one joint component. */
const keyTimes = (clip: AnimaPoseClipV2, joint: string, component: string) =>
  clip.joints![joint][component].map(
    (key) => beat(clip, key.beat).time + (key.dt ?? 0),
  );
const rotation = (
  clip: AnimaPoseClipV2,
  bone: VRMHumanBoneName,
  time: number,
) =>
  new Quaternion(
    ...prepareAnimaPoseClipV2(clip, context).sample(time).humanoid![bone]!
      .rotation!,
  );

/** Three beats without detail, keyed on the head and an expression. */
const plain = (): AnimaPoseClipV2 =>
  valid({
    schema: "animaPoseClip/2.0",
    id: "plain",
    name: "Plain",
    duration: 3,
    basePose: RELAXED_REST_POSE_ID,
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
    expressions: { happy: [{ beat: "b", v: 0.5 }] },
  });

describe("beat detail", () => {
  it("finds the keys a beat owns away from its time", () => {
    const laugh = example("hearty-laugh");
    expect(beatHasDetail(laugh, "burst")).toBe(true);
    expect(beatDetailSummary(laugh, "burst")).toMatchObject({
      channels: expect.any(Number),
    });
    expect(beatHasDetail(plain(), "b")).toBe(false);
    expect(beatDetailSummary(plain(), "b")).toBeNull();
  });
});

describe("retimeBeat", () => {
  it("moves a beat's detail rigidly and keeps the clip ordered", () => {
    const laugh = example("hearty-laugh");
    const before = keyTimes(laugh, "chest", "flexion");
    const owned = laugh.joints!.chest.flexion.map(
      (key) => key.beat === "laughing",
    );
    const moved = valid(retimeBeat(laugh, "laughing", 1.3));
    expect(beat(moved, "laughing").time).toBe(1.3);
    keyTimes(moved, "chest", "flexion").forEach((time, index) => {
      if (owned[index]) expect(time).toBeCloseTo(before[index] + 0.1, 4);
    });
  });

  it("stops a beat with detail before it passes a neighbour", () => {
    const laugh = example("hearty-laugh");
    const moved = valid(retimeBeat(laugh, "recover", 0.2));
    expect(beat(moved, "recover").time).toBeGreaterThan(
      beat(moved, "laughing").time,
    );
    expect(moved.beats.map(({ id }) => id)).toEqual(
      laugh.beats.map(({ id }) => id),
    );
  });

  it("lets a beat without detail pass beats without detail", () => {
    const moved = valid(retimeBeat(plain(), "a", 1.5));
    expect(moved.beats.map(({ id }) => id)).toEqual(["b", "a", "c"]);
    expect(keyTimes(moved, "head", "flexion")).toEqual([1, 1.5, 2]);
  });
});

describe("deleteBeat, setBeatEase and setBeatLabel", () => {
  it("removes a beat with all of its keys", () => {
    const laugh = example("hearty-laugh");
    const deleted = valid(deleteBeat(laugh, "burst"));
    expect(deleted.beats.some(({ id }) => id === "burst")).toBe(false);
    expect(JSON.stringify(deleted)).not.toContain('"burst"');
  });

  it("sets the arrival of every key a beat owns", () => {
    const wave = example("wave-hello");
    const eased = valid(setBeatEase(wave, "raise", "linear"));
    expect(beat(eased, "raise").ease).toBe("linear");
    for (const components of Object.values(eased.joints!))
      for (const keys of Object.values(components))
        for (const key of keys)
          if (key.beat === "raise") expect(key.ease).toBeUndefined();
    expect(beat(setBeatEase(eased, "raise", undefined), "raise").ease).toBe(
      undefined,
    );
  });

  it("relabels a beat", () => {
    expect(beat(setBeatLabel(plain(), "b", "  Nod  "), "b").label).toBe("Nod");
    expect(beat(setBeatLabel(plain(), "b", " "), "b").label).toBe("B");
  });
});

describe("setBeatPose", () => {
  it("re-targets a changed joint's detail and keeps unchanged joints", () => {
    const wave = example("wave-hello");
    const at = beat(wave, "raise").time;
    const pose = beatKeyPose(wave, "raise", context);
    const lifted = new Quaternion(...pose.humanoid!.rightUpperArm!.rotation!)
      .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.1))
      .toArray() as [number, number, number, number];
    const edited = valid(
      setBeatPose(
        wave,
        "raise",
        {
          ...pose,
          humanoid: {
            ...pose.humanoid,
            rightUpperArm: { rotation: lifted },
          },
        },
        context,
      ),
    );
    expect(
      angularDistanceDegrees(
        rotation(edited, "rightUpperArm", at),
        new Quaternion(...lifted),
      ),
    ).toBeLessThan(0.01);
    // Other beats' keys are untouched.
    for (const [name, keys] of Object.entries(wave.joints!.rightUpperArm))
      expect(
        edited.joints!.rightUpperArm[name].filter(
          (key) => key.beat !== "raise",
        ),
      ).toEqual(keys.filter((key) => key.beat !== "raise"));
    expect(edited.joints!.head).toEqual(wave.joints!.head);
    // Away from the beat's reach, the motion is unchanged.
    const late = beat(wave, "settle").time + 0.05;
    expect(
      angularDistanceDegrees(
        rotation(edited, "rightUpperArm", late),
        rotation(wave, "rightUpperArm", late),
      ),
    ).toBeLessThan(0.01);
  });

  it("gives an untracked bone a rotation track keyed at every beat", () => {
    const clip = plain();
    const pose = beatKeyPose(clip, "b", context);
    const turned = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), 0.3)
      .toArray() as [number, number, number, number];
    const edited = valid(
      setBeatPose(
        clip,
        "b",
        {
          ...pose,
          humanoid: { ...pose.humanoid, leftHand: { rotation: turned } },
        },
        context,
      ),
    );
    expect(edited.rotations!.leftHand!.map((key) => key.beat)).toEqual([
      "a",
      "b",
      "c",
    ]);
    // Keys carry the saved precision, so the draft equals what Save writes.
    for (const key of edited.rotations!.leftHand!)
      for (const component of key.q)
        expect(component).toBe(Number(component.toFixed(5)));
    expect(
      angularDistanceDegrees(
        rotation(edited, "leftHand", 0),
        rotation(clip, "leftHand", 0),
      ),
    ).toBeLessThan(0.01);
  });

  it("sets expressions at the beat, zeroing names the pose omits", () => {
    const edited = valid(
      setBeatPose(plain(), "b", { expressions: { angry: 0.4 } }, context),
    );
    const at = (clip: AnimaPoseClipV2) =>
      prepareAnimaPoseClipV2(clip, context).sample(1).expressions!;
    expect(at(edited).angry).toBeCloseTo(0.4);
    expect(at(edited).happy).toBeCloseTo(0);
  });
});

describe.each(["AvatarSample_A_1_New", "AvatarSample_Y_0"] as const)(
  "hand keys on %s",
  (avatarId) => {
    let avatar: BeatEditContext;
    beforeAll(async () => {
      avatar = { vrm: await loadTestAvatar(avatarId), resolvePose };
    });
    type Tuple = [number, number, number, number];
    const sampled = (
      clip: AnimaPoseClipV2,
      bone: VRMHumanBoneName,
      time: number,
    ) =>
      new Quaternion(
        ...(prepareAnimaPoseClipV2(clip, avatar).sample(time).humanoid![bone]
          ?.rotation ?? [0, 0, 0, 1]),
      );
    const fingers = (side: "left" | "right") =>
      [...handShapeRotations(avatar.vrm!, side, { preset: "fist" }, undefined)]
        .map(([bone]) => bone)
        .concat(`${side}ThumbMetacarpal`);
    /** Whether `edited` plays these bones as `clip` does at these times. */
    const expectSameHand = (
      edited: AnimaPoseClipV2,
      clip: AnimaPoseClipV2,
      times: number[],
      side: "left" | "right" = "right",
    ) => {
      for (const time of times)
        for (const bone of fingers(side))
          expect(
            angularDistanceDegrees(
              sampled(edited, bone, time),
              sampled(clip, bone, time),
            ),
            `${bone} at ${time}`,
          ).toBeLessThan(0.01);
    };
    /** A beat's key pose with joint-model changes (degrees) to some bones. */
    const changedPose = (
      clip: AnimaPoseClipV2,
      beatId: string,
      changes: Partial<Record<VRMHumanBoneName, Record<string, number>>>,
    ) => {
      const pose = beatKeyPose(clip, beatId, avatar);
      const humanoid = { ...pose.humanoid };
      for (const [bone, change] of Object.entries(changes)) {
        const joint = resolveJoint(bone)!;
        const values = decomposeJointRotation(
          joint,
          new Quaternion(
            ...(humanoid[bone as VRMHumanBoneName]?.rotation ?? [0, 0, 0, 1]),
          ),
        );
        for (const [name, value] of Object.entries(change!))
          values[name] += value;
        humanoid[bone as VRMHumanBoneName] = {
          rotation: composeJointRotation(joint, values).toArray() as Tuple,
        };
      }
      return { ...pose, humanoid };
    };
    const expectPlays = (
      clip: AnimaPoseClipV2,
      humanoid: NonNullable<ReturnType<typeof changedPose>["humanoid"]>,
      bones: VRMHumanBoneName[],
      time: number,
      tolerance = 0.05,
    ) => {
      for (const bone of bones)
        expect(
          angularDistanceDegrees(
            sampled(clip, bone, time),
            new Quaternion(...humanoid[bone]!.rotation!),
          ),
          bone,
        ).toBeLessThan(tolerance);
    };
    /** Right-hand keys at each of three beats, the middle one a pinch. */
    const handClip = (): AnimaPoseClipV2 =>
      valid({
        ...plain(),
        hands: {
          right: [
            { beat: "a", preset: "relaxed" },
            { beat: "b", preset: "pinch", curl: 5 },
            { beat: "c", preset: "open-together", spread: 8 },
          ],
        },
      });

    it("writes finger edits at a beat's hand key as offsets on that key", () => {
      const clip = handClip();
      const pose = changedPose(clip, "b", {
        rightIndexIntermediate: { curl: 15 },
        rightThumbDistal: { curl: -10 },
        rightLittleProximal: { splay: 6 },
      });
      const edited = valid(setBeatPose(clip, "b", pose, avatar));
      expect(edited.hands!.right).toEqual([
        clip.hands!.right![0],
        {
          beat: "b",
          preset: "pinch",
          curl: 5,
          fingers: {
            thumb: { curl: [0, -10] },
            index: { curl: [0, 15, 0] },
            little: { splay: 6 },
          },
        },
        clip.hands!.right![2],
      ]);
      expect(edited.rotations).toBeUndefined();
      expect(Object.keys(edited.joints!)).toEqual(["head"]);
      expectPlays(
        edited,
        pose.humanoid,
        [
          "rightIndexIntermediate",
          "rightThumbDistal",
          "rightLittleProximal",
          "rightThumbProximal",
        ],
        1,
      );
      expectSameHand(edited, clip, [0, 2]);
    });

    it("adds a key from the nearest key's preset at a beat without one", () => {
      const wave = example("wave-hello");
      const pose = changedPose(wave, "wave", {
        rightIndexProximal: { curl: 20 },
        rightMiddleIntermediate: { curl: -10 },
      });
      const edited = valid(setBeatPose(wave, "wave", pose, avatar));
      const own = edited.hands!.right!.filter(({ beat }) => beat === "wave");
      expect(own).toEqual([
        {
          beat: "wave",
          preset: "open-together",
          spread: 8,
          fingers: {
            index: { curl: [20, 0, 0] },
            middle: { curl: [0, -10, 0] },
          },
        },
      ]);
      expect(
        edited.hands!.right!.filter(({ beat }) => beat !== "wave"),
      ).toEqual(wave.hands!.right);
      expect(edited.rotations).toEqual(wave.rotations);
      expectPlays(
        edited,
        pose.humanoid,
        fingers("right").filter((bone) => !bone.endsWith("Metacarpal")),
        beat(wave, "wave").time,
      );
      expectSameHand(edited, wave, [0, 0.45, 1.85, 2.35]);
    });

    it("gives edits offsets cannot express joint tracks at every hand key", () => {
      const clip = handClip();
      const pose = changedPose(clip, "b", {
        rightIndexIntermediate: { twist: 12 },
        rightRingProximal: { curl: 10 },
      });
      const edited = valid(setBeatPose(clip, "b", pose, avatar));
      expect(edited.hands!.right![1]).toEqual({
        beat: "b",
        preset: "pinch",
        curl: 5,
        fingers: { ring: { curl: [10, 0, 0] } },
      });
      const track = edited.joints!.rightIndexIntermediate;
      expect(Object.keys(track).sort()).toEqual(["curl", "splay", "twist"]);
      for (const keys of Object.values(track))
        expect(keys.map((key) => key.beat)).toEqual(["a", "b", "c"]);
      expectPlays(
        edited,
        pose.humanoid,
        ["rightIndexIntermediate", "rightRingProximal"],
        1,
      );
      expectSameHand(edited, clip, [0, 2]);
    });

    it("keys a thumb metacarpal edit at every hand key", () => {
      const clip = handClip();
      const pose = beatKeyPose(clip, "b", avatar);
      const turned = new Quaternion(
        ...(pose.humanoid!.rightThumbMetacarpal?.rotation ?? [0, 0, 0, 1]),
      )
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2))
        .toArray() as Tuple;
      const humanoid = {
        ...pose.humanoid,
        rightThumbMetacarpal: { rotation: turned },
      };
      const edited = valid(
        setBeatPose(clip, "b", { ...pose, humanoid }, avatar),
      );
      expect(
        edited.rotations!.rightThumbMetacarpal!.map((key) => key.beat),
      ).toEqual(["a", "b", "c"]);
      // The thumb keeps its turn relative to the metacarpal, as shown.
      expectPlays(
        edited,
        humanoid,
        ["rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal"],
        1,
      );
      expectSameHand(edited, clip, [0, 2]);
    });

    it("writes a Hands-tool shape as the beat's key, playing as shown", () => {
      const clip = handClip();
      const shape: HandShape = {
        preset: "fist",
        curl: 10,
        fingers: { index: { curl: [-20, 0, 0] } },
      };
      const pose = beatKeyPose(clip, "b", avatar);
      const humanoid = { ...pose.humanoid };
      for (const [bone, rotation] of handShapeRotations(
        avatar.vrm!,
        "right",
        shape,
        pose.humanoid!.rightThumbMetacarpal?.rotation,
      ))
        humanoid[bone] = { rotation: rotation.toArray() as Tuple };
      const edited = valid(
        setBeatPose(
          clip,
          "b",
          { ...pose, humanoid, hands: { right: shape } },
          avatar,
        ),
      );
      expect(edited.hands!.right![1]).toEqual({ beat: "b", ...shape });
      expect(edited.rotations).toBeUndefined();
      expectPlays(
        edited,
        humanoid,
        fingers("right").filter((bone) => !bone.endsWith("Metacarpal")),
        1,
        0.01,
      );
      expectSameHand(edited, clip, [0, 2]);
    });

    it("starts a hand track when a shape is chosen for a hand without keys", () => {
      const clip = plain();
      const shape: HandShape = { preset: "point" };
      const pose = beatKeyPose(clip, "b", avatar);
      const humanoid = { ...pose.humanoid };
      for (const [bone, rotation] of handShapeRotations(
        avatar.vrm!,
        "left",
        shape,
        pose.humanoid!.leftThumbMetacarpal?.rotation,
      ))
        humanoid[bone] = { rotation: rotation.toArray() as Tuple };
      const edited = valid(
        setBeatPose(
          clip,
          "b",
          { ...pose, humanoid, hands: { left: shape } },
          avatar,
        ),
      );
      // The other beats hold the base pose's relaxed fingers as before.
      expect(edited.hands).toEqual({
        left: [
          { beat: "a", preset: "relaxed" },
          { beat: "b", preset: "point" },
          { beat: "c", preset: "relaxed" },
        ],
      });
      expect(edited.rotations).toBeUndefined();
      expectSameHand(edited, clip, [0, 2], "left");
    });

    it("keeps finger edits of a hand without keys as rotation tracks", () => {
      const clip = plain();
      const pose = changedPose(clip, "b", { leftIndexProximal: { curl: 30 } });
      const edited = valid(setBeatPose(clip, "b", pose, avatar));
      expect(edited.hands).toBeUndefined();
      expect(
        edited.rotations!.leftIndexProximal!.map((key) => key.beat),
      ).toEqual(["a", "b", "c"]);
    });

    /** Keys `fist` at a and `open-spread` at c: beat b shows a blend. */
    const blendClip = (): AnimaPoseClipV2 =>
      valid({
        ...plain(),
        hands: {
          right: [
            { beat: "a", preset: "fist" },
            { beat: "c", preset: "open-spread" },
          ],
        },
      });
    const fingerTracks = (clip: AnimaPoseClipV2) =>
      [
        ...Object.keys(clip.joints ?? {}),
        ...Object.keys(clip.rotations ?? {}),
      ].filter((bone) =>
        /^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(bone),
      );

    it("keeps an expressible edit between two different keys as offsets", () => {
      const clip = blendClip();
      const pose = changedPose(clip, "b", {
        rightIndexProximal: { curl: 10 },
        rightMiddleIntermediate: { curl: -15 },
      });
      const edited = valid(setBeatPose(clip, "b", pose, avatar));
      expect(fingerTracks(edited)).toEqual([]);
      const key = edited.hands!.right!.find(({ beat }) => beat === "b")!;
      expect(key.preset).toBe("fist");
      // Offsets approximate the blend: every finger plays within a few
      // degrees of the hand as shown, the edited ones included.
      expectPlays(
        edited,
        pose.humanoid,
        fingers("right").filter((bone) => !bone.endsWith("Metacarpal")),
        1,
        4.5,
      );
      expectSameHand(edited, clip, [0, 2]);
    });

    it("gives a twist between two different keys a fallback track", () => {
      const clip = blendClip();
      const pose = changedPose(clip, "b", {
        rightIndexIntermediate: { twist: 15 },
        rightRingProximal: { curl: 10 },
      });
      const edited = valid(setBeatPose(clip, "b", pose, avatar));
      expect(fingerTracks(edited)).toEqual(["rightIndexIntermediate"]);
      for (const keys of Object.values(edited.joints!.rightIndexIntermediate))
        expect(keys.map((key) => key.beat)).toEqual(["a", "b", "c"]);
      expectPlays(edited, pose.humanoid, ["rightIndexIntermediate"], 1);
      expectSameHand(edited, clip, [0, 2]);
    });
  },
);

describe("hand keys follow their beats", () => {
  it("takes a new key's preset from the nearest key, across a loop's seam", () => {
    const clip = (loop: boolean) =>
      valid({
        schema: "animaPoseClip/2.0",
        id: "seam",
        name: "Seam",
        duration: 3,
        ...(loop ? { loop: true } : {}),
        basePose: RELAXED_REST_POSE_ID,
        beats: [
          { id: "a", label: "A", time: 0.1 },
          { id: "c", label: "C", time: 2 },
          { id: "d", label: "D", time: 2.9 },
        ],
        hands: {
          right: [
            { beat: "a", preset: "fist" },
            { beat: "c", preset: "open-spread" },
          ],
        },
      });
    // Beat d is 0.2 s from a across the seam and 0.9 s from c.
    for (const [loop, preset] of [
      [true, "fist"],
      [false, "open-spread"],
    ] as const) {
      const source = clip(loop);
      const pose = beatKeyPose(source, "d", context);
      const joint = resolveJoint("rightIndexProximal")!;
      const values = decomposeJointRotation(
        joint,
        new Quaternion(...pose.humanoid!.rightIndexProximal!.rotation!),
      );
      const edited = valid(
        setBeatPose(
          source,
          "d",
          {
            ...pose,
            humanoid: {
              ...pose.humanoid,
              rightIndexProximal: {
                rotation: composeJointRotation(joint, {
                  ...values,
                  curl: values.curl + 5,
                }).toArray() as [number, number, number, number],
              },
            },
          },
          context,
        ),
      );
      expect(
        edited.hands!.right!.find(({ beat }) => beat === "d")?.preset,
        `loop: ${loop}`,
      ).toBe(preset);
    }
  });

  it("moves a retimed beat's hand keys and removes a deleted beat's", () => {
    const wave = example("wave-hello");
    const moved = valid(retimeBeat(wave, "lower", 2.2));
    const keys = (clip: AnimaPoseClipV2) =>
      clip.hands!.right!.map((key) => ({
        beat: key.beat,
        time: Number((beat(clip, key.beat).time + (key.dt ?? 0)).toFixed(4)),
      }));
    // Its own key moves rigidly; the facing detail of the beat after it
    // compresses with the smaller gap (0.5 s to 0.3 s).
    expect(keys(moved)).toEqual([
      { beat: "start", time: 0 },
      { beat: "raise", time: 0.45 },
      { beat: "lower", time: 2.05 },
      { beat: "settle", time: 2.41 },
    ]);
    expect(moved.hands!.right!.map(({ preset }) => preset)).toEqual(
      wave.hands!.right!.map(({ preset }) => preset),
    );
    const deleted = valid(deleteBeat(wave, "raise"));
    expect(deleted.hands!.right).toEqual(
      wave.hands!.right!.filter((key) => key.beat !== "raise"),
    );
  });
});

describe("insertBeat", () => {
  it("adds a beat without detail that pins the current pose", () => {
    const { clip, beatId } = insertBeat(
      plain(),
      { timeSec: 1.5, label: "Captured" },
      context,
    );
    const inserted = valid(clip);
    expect(beat(inserted, beatId)).toMatchObject({
      label: "Captured",
      time: 1.5,
    });
    expect(beatHasDetail(inserted, beatId)).toBe(false);
    expect(inserted.joints!.head.flexion.map((key) => key.beat)).toEqual([
      "a",
      "b",
      beatId,
      "c",
    ]);
    // An occupied time returns the beat already there.
    expect(
      insertBeat(inserted, { timeSec: 1.5, label: "Again" }, context),
    ).toMatchObject({ beatId });
  });

  it("takes over a neighbour's detail that the new beat separates", () => {
    const wave = example("wave-hello");
    const { clip, beatId } = insertBeat(
      wave,
      { timeSec: 1.4, label: "Captured" },
      context,
    );
    const inserted = valid(clip);
    expect(beatHasDetail(inserted, beatId)).toBe(true);
    for (const time of [0.6, 1.4, 1.7])
      expect(
        angularDistanceDegrees(
          rotation(inserted, "rightUpperArm", time),
          rotation(wave, "rightUpperArm", time),
        ),
      ).toBeLessThan(0.5);
  });
});

describe("detachBasePose", () => {
  it.each(["hearty-laugh", "thinking-chin-rest", "wave-hello"])(
    "freezes the base pose of %s without changing its motion",
    (name) => {
      const clip = example(name);
      expect(clip.basePose).toBeDefined();
      const detached = valid(detachBasePose(clip, context)!);
      expect(detached.basePose).toBeUndefined();
      const before = prepareAnimaPoseClipV2(clip, context);
      // Nothing resolves now: the clip carries its base by value.
      const after = prepareAnimaPoseClipV2(detached, {
        vrm: a1,
        resolvePose: () => null,
      });
      for (let time = 0; time <= clip.duration; time += clip.duration / 23) {
        const expected = before.sample(time).humanoid!;
        const actual = after.sample(time).humanoid!;
        expect(Object.keys(actual).sort()).toEqual(
          Object.keys(expected).sort(),
        );
        for (const [bone, transform] of Object.entries(expected)) {
          const other = actual[bone as VRMHumanBoneName]!;
          if (transform?.rotation)
            expect(
              angularDistanceDegrees(
                new Quaternion(...transform.rotation),
                new Quaternion(...other.rotation!),
              ),
              // Frozen keys are stored at the saved precision (5 decimals).
            ).toBeLessThan(5e-3);
          transform?.position?.forEach((value, index) =>
            expect(other.position![index]).toBeCloseTo(value, 6),
          );
        }
      }
    },
  );

  it("rejects a base pose that does not resolve", () => {
    expect(
      detachBasePose(
        { ...example("wave-hello"), basePose: "missing" },
        { vrm: a1, resolvePose: () => null },
      ),
    ).toBeNull();
  });
});

describe("contacts follow the clip", () => {
  it("keeps a whole-clip contact inside the clip when its beat moves", () => {
    const clip = example("thinking-chin-rest");
    for (const beat of clip.beats)
      for (let time = 0; time <= clip.duration; time += clip.duration / 12)
        valid(retimeBeat(clip, beat.id, time));
  });

  /** Absolute window of a contact. */
  const windowOf = (clip: AnimaPoseClipV2, index: number) => {
    const contact = clip.contacts![index];
    const time = beat(clip, contact.beat).time;
    return [time + contact.from, time + contact.to].map(
      (value) => Math.round(value * 1e4) / 1e4,
    );
  };
  /**
   * Four beats with a solved palm held on the head from "b" to "c", its
   * unsolved twin, and a solved left contact inside the gap after "c".
   */
  const touching = (): AnimaPoseClipV2 =>
    valid({
      ...plain(),
      beats: [
        { id: "a", label: "A", time: 0 },
        { id: "b", label: "B", time: 1 },
        { id: "c", label: "C", time: 2 },
        { id: "d", label: "D", time: 2.5 },
      ],
      contacts: [
        {
          bone: "rightHand",
          point: "palm",
          target: "head",
          beat: "b",
          from: 0,
          to: 1,
          solve: {},
        },
        { bone: "rightHand", target: "head", beat: "b", from: 0, to: 1 },
        {
          bone: "leftHand",
          target: "rightHand",
          beat: "c",
          from: 0.25,
          to: 0.4,
          solve: { blendIn: 0.05 },
        },
      ],
    });

  it("maps solved windows through retimed beats; unsolved ones move with their beat", () => {
    const later = valid(retimeBeat(touching(), "c", 2.2));
    // The solved window still ends on "c"; the one after "c" stretches with
    // its gap (2.25 and 2.4 of 2–2.5 become 2.35 and 2.44 of 2.2–2.5).
    expect(windowOf(later, 0)).toEqual([1, 2.2]);
    expect(windowOf(later, 1)).toEqual([1, 2]);
    expect(windowOf(later, 2)).toEqual([2.35, 2.44]);
    expect(later.contacts![2]).toMatchObject({ from: 0.15, to: 0.24 });
    expect(later.contacts![0].solve).toEqual({});
    expect(later.contacts![2].solve).toEqual({ blendIn: 0.05 });

    const earlier = valid(retimeBeat(touching(), "b", 0.6));
    expect(earlier.contacts![0]).toMatchObject({ from: 0, to: 1.4 });
    expect(windowOf(earlier, 0)).toEqual([0.6, 2]);
    // Unsolved: the same offsets from its moved beat.
    expect(earlier.contacts![1]).toMatchObject({ from: 0, to: 1 });
    expect(windowOf(earlier, 1)).toEqual([0.6, 1.6]);
    expect(windowOf(earlier, 2)).toEqual([2.25, 2.4]);
  });

  it("keeps chained solved windows apart when a retime squeezes them", () => {
    const palms = (from: number, to: number): AnimaPoseClipContact => ({
      bone: "rightHand",
      point: "palm",
      target: "leftHand",
      targetPoint: "palm",
      beat: "b",
      from,
      to,
      solve: {},
    });
    const claps = valid({
      ...plain(),
      contacts: [palms(0, 0.05), palms(0.25, 0.3), palms(0.5, 0.55)],
    });
    const squeezed = valid(retimeBeat(claps, "c", 1.2));
    expect(
      squeezed.contacts!.map((_, index) => windowOf(squeezed, index)),
    ).toEqual([
      [1, 1.01],
      [1.05, 1.06],
      [1.1, 1.11],
    ]);
    const stretched = valid(retimeBeat(claps, "b", 0.5));
    expect(
      stretched.contacts!.map((_, index) => windowOf(stretched, index)),
    ).toEqual([
      [0.5, 0.575],
      [0.875, 0.95],
      [1.25, 1.325],
    ]);
  });

  it("stops a beat before a solved window would fold over it", () => {
    const solved = valid({
      ...plain(),
      contacts: [
        {
          bone: "rightHand",
          target: "head",
          beat: "c",
          from: -0.5,
          to: -0.2,
          solve: {},
        },
      ],
    });
    const moved = valid(retimeBeat(solved, "b", 2.5));
    expect(moved.beats.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(beat(moved, "b").time).toBeGreaterThan(1.99);
    expect(beat(moved, "b").time).toBeLessThan(2);
    // Without solve the contact does not hold the beat back.
    const unsolved = { ...solved, contacts: [{ ...solved.contacts![0] }] };
    delete unsolved.contacts[0].solve;
    expect(
      valid(retimeBeat(unsolved, "b", 2.5)).beats.map(({ id }) => id),
    ).toEqual(["a", "c", "b"]);
  });

  it("clamps a window to the duration and drops one that collapses", () => {
    const clip = example("arms-crossed");
    const shortened = fitContactsToClip({ ...clip, duration: 2 });
    expect(shortened.contacts?.[0]).toMatchObject({ from: 0, to: 2 });
    const beyond = fitContactsToClip({
      ...clip,
      contacts: [{ ...clip.contacts![0], from: 2.5, to: 2.6 }],
    });
    expect(beyond.contacts).toBeUndefined();
  });
});
