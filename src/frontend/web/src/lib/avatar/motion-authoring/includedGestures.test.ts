import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM } from "@pixiv/three-vrm";
import { beforeAll, describe, expect, it } from "vitest";

import { getManifestGestureEntries } from "../animationManifest";
import {
  MAX_ANIMA_POSE_CLIP_BYTES,
  serializeAnimaPoseClipFile,
  validateAnimaPoseClipV2,
} from "../poses/animaPoseClip";
import { checkMotion } from "./checks";
import { INCLUDED_AVATAR_FILES, type IncludedAvatarId } from "./headlessVrm";
import { loadTestAvatar } from "./testing/includedAvatars";

/**
 * Every Included animaPoseClip/2.0 Gesture must validate, save within the
 * size limit and, unless listed below, pass the motion checks on both
 * Included Avatars.
 */

/**
 * Owner-authored Gestures converted from animaPoseClip/1.0 without motion
 * changes (#337) whose hand-made poses touch the body or pass joint limits
 * on purpose, so the motion checks for authored clips do not apply.
 */
const MOTION_CHECK_EXEMPT = new Set(["meme-dab", "shy-finger-poke-loop"]);

/**
 * Gestures whose original clips fail the checks only on Andrew, whose wider
 * shoulders and torso leave 1–3 cm forearm/torso overlaps and touches a few
 * centimetres off; the owner judged them fine at chat framing (2026-10-20).
 * They must still pass on Annie, and each stays listed only while it fails on
 * Andrew: remove it here once its clip is retuned.
 */
const KNOWN_ANDREW_FAILURES = new Set([
  "arms-crossed",
  "blow-a-kiss-2",
  "cover-face-and-peek",
  "detective-squint",
  "energy-wave",
  "flex",
  "flustered-fan",
  "freezing-shiver",
  "goodbye-wave",
  "hands-behind-head-relax",
  "have-an-idea",
  "heart-shot-oof",
  "hysterical-laughter",
  "innocent-whistle",
  "lean-in-coy",
  "medium-laugh",
  "phew-brow-wipe",
  "pout-huff",
  "simmering-huff",
  "single-hand-on-heart",
  "stretch-break",
  "tantrum-stomp",
  "thinking-chin-rest",
  "virtual-hug",
]);
const directory = fileURLToPath(
  new URL("../../../../../../../content/included/gestures/", import.meta.url),
);
const clips = readdirSync(directory)
  .map((slug) => `${slug}/${slug}.json`)
  // VRMA-only Gestures have no clip file.
  .filter(
    (file) =>
      existsSync(directory + file) &&
      JSON.parse(readFileSync(directory + file, "utf8")).schema ===
        "animaPoseClip/2.0",
  );

let avatars: { id: IncludedAvatarId; vrm: VRM }[];
beforeAll(async () => {
  avatars = await Promise.all(
    (Object.keys(INCLUDED_AVATAR_FILES) as IncludedAvatarId[]).map(
      async (id) => ({ id, vrm: await loadTestAvatar(id) }),
    ),
  );
});

describe("Included 2.0 Gestures", () => {
  it("covers every authored Gesture", () => {
    expect(clips).toHaveLength(152);
  });

  it("lists only existing Gestures as exempt or as known Andrew failures", () => {
    const slugs = new Set(clips.map((file) => file.split("/")[0]));
    for (const slug of [...MOTION_CHECK_EXEMPT, ...KNOWN_ANDREW_FAILURES]) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });

  it.each(clips)(
    "%s validates and passes the checks",
    (file) => {
      const result = validateAnimaPoseClipV2(
        JSON.parse(readFileSync(directory + file, "utf8")),
      );
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(
        Buffer.byteLength(serializeAnimaPoseClipFile(result.clip)),
      ).toBeLessThan(MAX_ANIMA_POSE_CLIP_BYTES);
      const slug = file.split("/")[0];
      if (MOTION_CHECK_EXEMPT.has(slug)) return;
      const fails = (checked: typeof avatars) =>
        checkMotion(result.clip, checked).findings.filter(
          (f) => f.severity === "fail",
        );
      if (KNOWN_ANDREW_FAILURES.has(slug)) {
        expect(fails(avatars.filter(({ id }) => id !== "Andrew"))).toEqual([]);
        expect(fails(avatars).length).toBeGreaterThan(0);
        return;
      }
      expect(fails(avatars)).toEqual([]);
    },
    60000,
  );
});

/**
 * The motion manifest repeats each clip-backed Gesture's name, duration and
 * loop kind for chat playback, so they must agree with the clip.
 */
describe("Included Gesture manifest entries", () => {
  const entries = getManifestGestureEntries().filter(
    (entry) => entry.type === "animaPoseClip",
  );

  it.each(entries.map((entry) => [entry.file, entry] as const))(
    "%s matches its clip's name, duration and loop",
    (file, entry) => {
      const clip = JSON.parse(
        readFileSync(`${directory}${file}/${file}.json`, "utf8"),
      );
      expect({
        name: entry.name,
        duration: entry.duration,
        loops: entry.loopType === "repeat",
      }).toEqual({
        name: clip.name,
        duration: clip.duration,
        loops: clip.loop === true,
      });
    },
  );
});
