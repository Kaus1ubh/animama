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
  it.each(Object.entries(AVATAR_POSE_CLIP_CATALOG))(
    "plays Included Gesture %s as before",
    (_id, clip) => {
      const result = conversionError(clip);
      expect(result.degrees).toBeLessThan(0.01);
      expect(result.metres).toBeLessThan(0.0001);
      expect(result.weight).toBeLessThan(0.001);
      expect(result.converted.beats).toHaveLength(clip.poseKeyframes.length);
    },
  );

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
