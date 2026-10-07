import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import clipSamples from "./fixtures/starter-clip-samples-before-reduction.json";
import {
  isAnimaPoseClipV2,
  parseAnimaPoseClip,
  parseAnyAnimaPoseClip,
  sampleAnimaPoseClip,
  type AnimaPoseClip,
} from "./animaPoseClip";
import originalInventory from "./fixtures/starter-inventory-before-content.json";
import { parseAnimaPose, resolveAnimaPose } from "./animaPose";
import {
  AVATAR_POSE_CATALOG,
  AVATAR_POSE_CLIP_CATALOG,
  AVATAR_POSE_IDS,
  AVATAR_REACTION_CLIP_CATALOG,
  DEFAULT_AVATAR_POSE_IDS,
  getAvatarPoseClip,
  getResolvedAvatarPose,
} from "./catalog";

const includedRoot = fileURLToPath(
  new URL("../../../../../../../content/included/poses/", import.meta.url),
);

/** Ignore sub-picometre normalization noise while protecting every effective value. */
function roundedCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(roundedCanonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, roundedCanonical(entry)]),
    );
  }
  return typeof value === "number"
    ? Number(value.toFixed(originalInventory.numeric_precision))
    : value;
}

/** 1.0 clips, the only ones that reference internal poses. */
const v1Clips = Object.values(AVATAR_POSE_CLIP_CATALOG).filter(
  (clip): clip is AnimaPoseClip => !isAnimaPoseClipV2(clip),
);

/**
 * Internal poses of Gestures replaced by 2.0 clips. No shipped clip references
 * them, but imported 1.0 packages may (content package capabilities list them
 * as built-in poses), so they stay in the runtime catalog.
 */
const RETAINED_INTERNAL_POSE_IDS = [
  "arms-crossed",
  "cat-monster-rawr",
  "cat-monster-rawr-2",
  "cheeky-finger-guns",
  "cheeky-finger-guns-2",
  "hands-on-hips",
  "right-face-palm",
];

const starterNames: Record<string, string> = {
  relaxedRest: "Relaxed Rest",
  "shy-finger-poke-1": "Shy Finger Poke 1",
  "shy-finger-poke-2": "Shy Finger Poke 2",
  "thinking-head-scratch-1": "Thinking Head Scratch 1",
  "thinking-head-scratch-2": "Thinking Head Scratch 2",
};

describe("Included Pose starter collection", () => {
  it("exposes only the five requested starters while preserving their effective values", () => {
    expect(readdirSync(includedRoot).sort()).toEqual(
      Object.keys(starterNames).sort(),
    );
    expect(DEFAULT_AVATAR_POSE_IDS).toEqual(originalInventory.defaultPoseIds);
    for (const original of originalInventory.poses.filter(
      (pose) => pose.id in starterNames,
    )) {
      const resolved = getResolvedAvatarPose(original.id);
      expect(resolved.name).toBe(starterNames[original.id]);
      expect(
        createHash("sha256")
          .update(
            JSON.stringify(
              roundedCanonical({ ...resolved, name: original.name }),
            ),
          )
          .digest("hex"),
      ).toBe(original.resolved_sha256);
    }
  });

  it("exposes every starter as canonical parent-free Included content", () => {
    expect(existsSync(includedRoot)).toBe(true);
    const entries = readdirSync(includedRoot).sort();
    expect(entries).toEqual(Object.keys(starterNames).sort());
    for (const id of entries) {
      const descriptor = JSON.parse(
        readFileSync(`${includedRoot}/${id}/${id}.json`, "utf8"),
      );
      expect(descriptor).toMatchObject({
        schema_version: 1,
        content_type: "pose",
        content_id: id,
        name: AVATAR_POSE_CATALOG[id].name,
      });
      expect(descriptor.pose).not.toHaveProperty("parent");
      expect(parseAnimaPose(descriptor.pose)).toEqual(AVATAR_POSE_CATALOG[id]);
      expect(roundedCanonical(descriptor.pose)).toEqual(
        roundedCanonical(getResolvedAvatarPose(id)),
      );
    }
  });

  it("keeps shipped gesture refs resolvable without exposing their dependencies as content", () => {
    const meme = AVATAR_POSE_CLIP_CATALOG["meme-dab"];
    expect(!isAnimaPoseClipV2(meme) && meme.poses["meme-dab"]).toEqual({
      ref: "meme-dab",
    });
    expect(AVATAR_POSE_CLIP_CATALOG["double-thumbs-up"].basePose).toBe(
      "double-thumbs-up",
    );
    const referencedIds = new Set<string>();
    for (const clip of Object.values(AVATAR_POSE_CLIP_CATALOG)) {
      if (clip.basePose) referencedIds.add(clip.basePose);
    }
    for (const clip of v1Clips) {
      for (const pose of Object.values(clip.poses)) {
        if ("ref" in pose) referencedIds.add(pose.ref);
      }
    }
    expect(
      RETAINED_INTERNAL_POSE_IDS.filter((id) => referencedIds.has(id)),
    ).toEqual([]);
    // Starter Poses are Included content whether or not a clip uses them.
    expect([...AVATAR_POSE_IDS].sort()).toEqual(
      [
        ...new Set([
          ...referencedIds,
          ...RETAINED_INTERNAL_POSE_IDS,
          ...Object.keys(starterNames),
        ]),
      ].sort(),
    );
    const internalIds = [...AVATAR_POSE_IDS].filter(
      (id) => !(id in starterNames),
    );
    expect(internalIds).toHaveLength(21);
    for (const original of originalInventory.poses.filter((pose) =>
      internalIds.includes(pose.id),
    )) {
      expect(existsSync(`${includedRoot}/${original.id}`)).toBe(false);
      expect(
        createHash("sha256")
          .update(
            JSON.stringify(
              roundedCanonical(getResolvedAvatarPose(original.id)),
            ),
          )
          .digest("hex"),
      ).toBe(original.resolved_sha256);
    }
  });

  it("keeps all shipped clip references and expression-only reactions resolvable", () => {
    expect(Object.keys(AVATAR_POSE_CLIP_CATALOG)).toHaveLength(37);
    expect(Object.keys(AVATAR_REACTION_CLIP_CATALOG)).toHaveLength(72);
    for (const clip of Object.values(AVATAR_POSE_CLIP_CATALOG))
      if (clip.basePose) expect(AVATAR_POSE_IDS).toContain(clip.basePose);
    for (const clip of [
      ...v1Clips,
      ...Object.values(AVATAR_REACTION_CLIP_CATALOG),
    ]) {
      if (clip.basePose) expect(AVATAR_POSE_IDS).toContain(clip.basePose);
      for (const pose of Object.values(clip.poses)) {
        if ("ref" in pose) expect(AVATAR_POSE_IDS).toContain(pose.ref);
      }
    }
  });

  it("preserves every shipped clip sample with internal pose dependencies", () => {
    // The six Gestures replaced by 2.0 clips are pinned by their bytes below.
    expect(clipSamples.clips).toHaveLength(16);
    for (const original of clipSamples.clips) {
      const clip = v1Clips.find(({ id }) => id === original.id);
      if (!clip) throw new Error(`${original.id} is not a 1.0 clip`);
      const included = JSON.parse(
        readFileSync(
          `${includedRoot}/../gestures/${clip.id}/${clip.id}.json`,
          "utf8",
        ),
      );
      expect(parseAnimaPoseClip(included)).toEqual(clip);
      for (const expected of original.samples) {
        const result = sampleAnimaPoseClip(
          clip,
          expected.time,
          (id) => AVATAR_POSE_CATALOG[id] ?? null,
        );
        expect(result.diagnostics.missingPoseRefs).toEqual([]);
        expect(
          createHash("sha256")
            .update(JSON.stringify(roundedCanonical(result.sample)))
            .digest("hex"),
          `${original.id} at ${expected.time}`,
        ).toBe(expected.sha256);
      }
    }
  });

  it("mirrors every Included clip Gesture byte for byte in the built-in catalog", () => {
    const gesturesRoot = `${includedRoot}/../gestures`;
    const clipGestures = readdirSync(gesturesRoot)
      .filter((slug) => {
        const meta = JSON.parse(
          readFileSync(`${gesturesRoot}/${slug}/${slug}.meta.json`, "utf8"),
        );
        return meta.implementation.kind === "anima_clip";
      })
      .sort();
    expect(clipGestures).toEqual(Object.keys(AVATAR_POSE_CLIP_CATALOG).sort());
    const mirrorRoot = fileURLToPath(new URL("./json/clips/", import.meta.url));
    const v2Ids: string[] = [];
    for (const slug of clipGestures) {
      const bytes = readFileSync(`${gesturesRoot}/${slug}/${slug}.json`);
      expect(readFileSync(`${mirrorRoot}/${slug}.json`).equals(bytes)).toBe(
        true,
      );
      const included = parseAnyAnimaPoseClip(JSON.parse(bytes.toString()));
      expect(included).toEqual(AVATAR_POSE_CLIP_CATALOG[slug]);
      if (isAnimaPoseClipV2(included)) v2Ids.push(slug);
    }
    expect(v2Ids).toHaveLength(21);
    // A 2.0 Gesture plays from the built-in catalog as a fresh copy.
    const replaced = getAvatarPoseClip("arms-crossed-clip");
    expect(isAnimaPoseClipV2(replaced) && replaced.loop).toBe(true);
    expect(replaced).toEqual(AVATAR_POSE_CLIP_CATALOG["arms-crossed"]);
    expect(replaced).not.toBe(AVATAR_POSE_CLIP_CATALOG["arms-crossed"]);
  });

  it("uses the current resolver's inheritance flags and partial-transform semantics", () => {
    const parent = parseAnimaPose({
      schema: "animaPose/1.0",
      id: "parent",
      name: "Parent",
      humanoid: {
        hips: { position: [0, 0.1, 0], rotation: [0, 0, 0, 1] },
        head: { rotation: [0, 0, 0, 1] },
      },
      expressions: { happy: 0.7, relaxed: 0.2 },
    });
    const child = {
      schema: "animaPose/1.0",
      id: "child",
      name: "Child",
      parent: { ref: "parent", inheritExpressions: true },
      humanoid: { hips: { position: [0, 0.3, 0] } },
      expressions: { happy: 0.4 },
    };
    const resolved = resolveAnimaPose(parseAnimaPose(child), () => parent);
    expect(resolved).toEqual({
      schema: "animaPose/1.0",
      id: "child",
      name: "Child",
      humanoid: {
        hips: { position: [0, 0.3, 0], rotation: [0, 0, 0, 1] },
        head: { rotation: [0, 0, 0, 1] },
      },
      expressions: { happy: 0.4, relaxed: 0.2 },
    });
    expect(
      resolveAnimaPose(
        parseAnimaPose({
          ...child,
          parent: { ref: "parent", inheritHumanoid: false },
        }),
        () => parent,
      ),
    ).toEqual({
      schema: "animaPose/1.0",
      id: "child",
      name: "Child",
      humanoid: { hips: { position: [0, 0.3, 0] } },
      expressions: { happy: 0.4 },
    });
  });
});
