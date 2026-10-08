import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { angularDistanceDegrees } from "../anatomy/anatomy";
import {
  AVATAR_POSE_CLIP_CATALOG,
  AVATAR_REACTION_CLIP_CATALOG,
  getResolvedAvatarPose,
} from "../catalog";
import { convertAnimaPoseClipToV2 } from "./convertV2";
import { getAnimaPoseClipTimelineDuration } from "./playback";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import { sampleAnimaPoseClip } from "./sampling";
import type { AnimaPoseClip } from "./schema";
import { isAnimaPoseClipV2 } from "./anyClip";
import { validateAnimaPoseClipV2 } from "./schemaV2";

const resolvePose = (id: string) => {
  try {
    return getResolvedAvatarPose(id);
  } catch {
    return null;
  }
};

/** Largest difference between 1.0 playback and its 2.0 conversion. */
function conversionError(clip: AnimaPoseClip) {
  const converted = convertAnimaPoseClipToV2(clip, resolvePose);
  const validated = validateAnimaPoseClipV2(converted);
  if (!validated.ok)
    throw new Error(`${clip.id}: ${JSON.stringify(validated.issues)}`);
  const prepared = prepareAnimaPoseClipV2(validated.clip, { resolvePose });
  const duration = getAnimaPoseClipTimelineDuration(clip);
  let degrees = 0;
  let metres = 0;
  let weight = 0;
  // Loops also cross their seam into a second cycle.
  const end = duration * (clip.loop ? 2 : 1);
  for (let t = 0; t <= end + 1e-9; t += 1 / 120) {
    const expected = sampleAnimaPoseClip(clip, t, resolvePose).sample;
    const actual = prepared.sample(t);
    for (const [bone, transform] of Object.entries(expected.humanoid ?? {})) {
      const other = actual.humanoid?.[bone as keyof typeof actual.humanoid];
      if (transform?.rotation)
        degrees = Math.max(
          degrees,
          angularDistanceDegrees(
            new Quaternion(...transform.rotation),
            new Quaternion(...other!.rotation!),
          ),
        );
      if (transform?.position)
        metres = Math.max(
          metres,
          new Vector3(...transform.position).distanceTo(
            new Vector3(...other!.position!),
          ),
        );
    }
    for (const [name, value] of Object.entries(expected.expressions ?? {}))
      weight = Math.max(weight, Math.abs(value - actual.expressions![name]));
  }
  return { converted: validated.clip, degrees, metres, weight };
}

describe("convertAnimaPoseClipToV2", () => {
  // 2.0 Included Gestures are authored as 2.0; only 1.0 ones convert.
  const v1Gestures = Object.entries(AVATAR_POSE_CLIP_CATALOG).filter(
    (entry): entry is [string, AnimaPoseClip] => !isAnimaPoseClipV2(entry[1]),
  );

  it.each(v1Gestures)("plays Included Gesture %s as before", (_id, clip) => {
    const result = conversionError(clip);
    expect(result.degrees).toBeLessThan(0.01);
    expect(result.metres).toBeLessThan(0.0001);
    expect(result.weight).toBeLessThan(0.001);
    expect(result.converted.beats).toHaveLength(clip.poseKeyframes.length);
  });

  it.each(Object.entries(AVATAR_REACTION_CLIP_CATALOG))(
    "plays Included Reaction %s as before",
    (_id, clip) => {
      const result = conversionError(clip);
      expect(result.weight).toBeLessThan(0.001);
      expect(result.converted.role).toBe(clip.role);
      expect(result.converted.playback).toEqual(clip.playback);
      expect(result.converted.events).toEqual(clip.events);
    },
  );

  const turned = (degrees: number): [number, number, number, number] => {
    const half = (degrees * Math.PI) / 360;
    return [0, Math.sin(half), 0, Math.cos(half)];
  };
  const loopClip = (
    duration: number,
    frames: [number, number, number][],
  ): AnimaPoseClip => ({
    schema: "animaPoseClip/1.0",
    id: "loop",
    name: "Loop",
    duration,
    loop: true,
    poses: Object.fromEntries(
      frames.map(([, degrees, happy], index) => [
        `p${index}`,
        {
          humanoid: { head: { rotation: turned(degrees) } },
          expressions: { happy },
        },
      ]),
    ),
    poseKeyframes: frames.map(([time], index) => ({
      time,
      pose: `p${index}`,
      transition: { easing: "linear" },
    })),
  });

  it.each([
    [
      "ends on a different pose at its duration",
      loopClip(1, [
        [0, 0, 0],
        [1, 40, 1],
      ]),
    ],
    [
      "ends before its duration",
      loopClip(2, [
        [0, 0, 0],
        [1, 40, 1],
      ]),
    ],
    [
      "starts after 0",
      loopClip(2, [
        [0.5, 0, 0],
        [1.5, 40, 1],
      ]),
    ],
  ])("plays a 1.0 loop that %s as before", (_name, clip) => {
    const result = conversionError(clip);
    expect(result.degrees).toBeLessThan(0.01);
    expect(result.weight).toBeLessThan(0.001);
  });

  it("spreads keyframes closer than the 2.0 minimum spacing", () => {
    const clip = loopClip(2, [
      [0, 0, 0],
      [1, 40, 1],
      [1.0003, 41, 1],
    ]);
    const converted = convertAnimaPoseClipToV2(
      { ...clip, loop: false },
      resolvePose,
    );
    expect(validateAnimaPoseClipV2(converted).ok).toBe(true);
    expect(converted.beats.map(({ time }) => time)).toEqual([0, 1, 1.0005]);
  });

  it("spreads close keyframes at any sub-tick time into a valid clip", () => {
    // Seeded, so failures reproduce. Half-tick times used to round the
    // spread spacing below the minimum.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 300; run += 1) {
      let time = 0;
      const keyframes: [number, number, number][] = [[0, 0, 0]];
      for (let index = 1; index < 6; index += 1) {
        time += 0.00005 + random() * 0.0008;
        keyframes.push([time, index * 5, 0]);
      }
      const converted = convertAnimaPoseClipToV2(
        { ...loopClip(1, keyframes), loop: false },
        resolvePose,
      );
      expect(validateAnimaPoseClipV2(converted).ok).toBe(true);
    }
  });

  it("starts a loop on a first keyframe just after 0", () => {
    const converted = convertAnimaPoseClipToV2(
      loopClip(2, [
        [0.0002, 0, 0],
        [1, 40, 1],
      ]),
      resolvePose,
    );
    expect(converted.beats[0]).toMatchObject({ time: 0, ease: "hold" });
    expect(converted.beats).toHaveLength(2);
  });

  it("labels beats from pose names and keeps fields it does not replace", () => {
    const converted = convertAnimaPoseClipToV2(
      {
        schema: "animaPoseClip/1.0",
        id: "rawr",
        name: "Rawr",
        duration: 1,
        mutedProceduralLayers: ["sway"],
        fadeIn: { duration: 0.3 },
        poses: {
          catMonsterRawr: { humanoid: { head: { rotation: [0, 0, 0, 1] } } },
        },
        poseKeyframes: [
          { time: 0, pose: "catMonsterRawr" },
          { time: 1, pose: "catMonsterRawr", transition: { easing: "linear" } },
        ],
        generator: "kept",
      } as AnimaPoseClip,
      resolvePose,
    );
    expect(converted.beats).toEqual([
      {
        id: "cat-monster-rawr",
        label: "Cat monster rawr",
        time: 0,
        ease: "easeInOutSine",
      },
      {
        id: "cat-monster-rawr-2",
        label: "Cat monster rawr",
        time: 1,
        ease: "linear",
      },
    ]);
    expect(converted).toMatchObject({
      mutedProceduralLayers: ["sway"],
      fadeIn: { duration: 0.3 },
      generator: "kept",
    });
    expect(converted).not.toHaveProperty("poses");
    expect(converted).not.toHaveProperty("defaultTransition");
  });
});

describe("convertAnimaPoseClipToV2 fades", () => {
  it("keeps the easing a fade inherited from the clip's default transition", () => {
    const converted = convertAnimaPoseClipToV2(
      {
        schema: "animaPoseClip/1.0",
        id: "fade",
        name: "Fade",
        duration: 1,
        defaultTransition: { easing: "linear" },
        fadeIn: { duration: 0.2 },
        poses: { a: { expressions: { happy: 1 } } },
        poseKeyframes: [{ time: 0, pose: "a" }],
      } as AnimaPoseClip,
      () => null,
    );
    expect(converted.fadeIn).toMatchObject({ duration: 0.2, easing: "linear" });
    expect(validateAnimaPoseClipV2(converted).ok).toBe(true);
  });
});
