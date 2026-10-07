import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM } from "@pixiv/three-vrm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MAX_ANIMA_POSE_CLIP_BYTES,
  serializeAnimaPoseClipFile,
  validateAnimaPoseClipV2,
} from "../poses/animaPoseClip";
import { checkMotion } from "./checks";
import { loadTestAvatar } from "./testing/includedAvatars";

/**
 * Every Included animaPoseClip/2.0 Gesture must validate, save within the
 * size limit and pass the motion checks on both Included Avatars.
 */
const directory = fileURLToPath(
  new URL("../../../../../../../content/included/gestures/", import.meta.url),
);
const clips = readdirSync(directory)
  .map((slug) => `${slug}/${slug}.json`)
  .filter(
    (file) =>
      JSON.parse(readFileSync(directory + file, "utf8")).schema ===
      "animaPoseClip/2.0",
  );

let vrm0: VRM;
let vrm1: VRM;
beforeAll(async () => {
  vrm0 = await loadTestAvatar("AvatarSample_Y_0");
  vrm1 = await loadTestAvatar("AvatarSample_A_1_New");
});

describe("Included 2.0 Gestures", () => {
  it("covers every authored Gesture", () => {
    expect(clips).toHaveLength(27);
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
      const checks = checkMotion(result.clip, [
        { id: "AvatarSample_Y_0", vrm: vrm0 },
        { id: "AvatarSample_A_1_New", vrm: vrm1 },
      ]);
      expect(checks.findings.filter((f) => f.severity === "fail")).toEqual([]);
    },
    60000,
  );
});
