import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import originalInventory from "./fixtures/starter-inventory-before-content.json";
import { parseAnimaPose, resolveAnimaPose } from "./animaPose";
import {
  AVATAR_POSE_CATALOG,
  AVATAR_POSE_CLIP_CATALOG,
  AVATAR_POSE_IDS,
  AVATAR_REACTION_CLIP_CATALOG,
  DEFAULT_AVATAR_POSE_IDS,
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

describe("Included Pose starter conversion", () => {
  it("preserves the captured pre-conversion inventory and effective runtime values", () => {
    expect([...AVATAR_POSE_IDS].sort()).toEqual(
      originalInventory.poses.map(({ id }) => id).sort(),
    );
    expect(DEFAULT_AVATAR_POSE_IDS).toEqual(originalInventory.defaultPoseIds);
    for (const original of originalInventory.poses) {
      const resolved = getResolvedAvatarPose(original.id);
      expect(resolved.name).toBe(original.name);
      expect(
        createHash("sha256")
          .update(JSON.stringify(roundedCanonical(resolved)))
          .digest("hex"),
      ).toBe(original.resolved_sha256);
    }
  });

  it("exposes every starter as canonical parent-free Included content", () => {
    expect(existsSync(includedRoot)).toBe(true);
    const entries = readdirSync(includedRoot).sort();
    expect(entries).toEqual([...AVATAR_POSE_IDS].sort());
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

  it("keeps all shipped clip references and expression-only reactions resolvable", () => {
    expect(Object.keys(AVATAR_POSE_CLIP_CATALOG)).toHaveLength(22);
    expect(Object.keys(AVATAR_REACTION_CLIP_CATALOG)).toHaveLength(72);
    for (const clip of [
      ...Object.values(AVATAR_POSE_CLIP_CATALOG),
      ...Object.values(AVATAR_REACTION_CLIP_CATALOG),
    ]) {
      if (clip.basePose) expect(AVATAR_POSE_IDS).toContain(clip.basePose);
      for (const pose of Object.values(clip.poses)) {
        if ("ref" in pose) expect(AVATAR_POSE_IDS).toContain(pose.ref);
      }
    }
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
