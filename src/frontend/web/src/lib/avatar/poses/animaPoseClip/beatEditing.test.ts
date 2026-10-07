import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import { loadTestAvatar } from "../../motion-authoring/testing/includedAvatars";
import { angularDistanceDegrees } from "../anatomy/anatomy";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../catalog";
import {
  beatDetailSummary,
  beatHasDetail,
  beatKeyPose,
  deleteBeat,
  detachBasePose,
  fitContactsToClip,
  flattenHandToFingerTracks,
  insertBeat,
  retimeBeat,
  setBeatEase,
  setBeatLabel,
  setBeatPose,
  type BeatEditContext,
} from "./beatEditing";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import { validateAnimaPoseClipV2, type AnimaPoseClipV2 } from "./schemaV2";

const resolvePose = (id: string) => getResolvedAvatarPose(id);
const example = (name: string): AnimaPoseClipV2 => {
  const result = validateAnimaPoseClipV2(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            `../../motion-authoring/examples/${name}.clip.json`,
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

  it("turns a preset hand into finger keys before editing a finger", () => {
    const wave = example("wave-hello");
    const pose = beatKeyPose(wave, "wave", context);
    const curled = new Quaternion(
      ...pose.humanoid!.rightIndexProximal!.rotation!,
    )
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.4))
      .toArray() as [number, number, number, number];
    const edited = valid(
      setBeatPose(
        wave,
        "wave",
        {
          ...pose,
          humanoid: {
            ...pose.humanoid,
            rightIndexProximal: { rotation: curled },
          },
        },
        context,
      ),
    );
    expect(edited.hands?.right).toBeUndefined();
    expect(edited.rotations?.rightIndexProximal).toBeDefined();
    expect(
      angularDistanceDegrees(
        rotation(edited, "rightIndexProximal", beat(wave, "wave").time),
        new Quaternion(...curled),
      ),
    ).toBeLessThan(0.01);
  });
});

describe("flattenHandToFingerTracks", () => {
  it("plays the same hand motion from finger keys", () => {
    const wave = example("wave-hello");
    const flat = valid(flattenHandToFingerTracks(wave, "right", context));
    expect(flat.hands?.right).toBeUndefined();
    for (let time = 0; time <= wave.duration; time += 0.1)
      for (const bone of ["rightIndexProximal", "rightThumbDistal"] as const)
        expect(
          angularDistanceDegrees(
            rotation(flat, bone, time),
            rotation(wave, bone, time),
          ),
        ).toBeLessThan(0.01);
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
