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
 * Every committed example clip (including the evaluation Gestures) must
 * validate, save within the size limit and pass the motion checks on both
 * Included Avatars.
 */
const directory = fileURLToPath(new URL("./examples/", import.meta.url));
const examples = readdirSync(directory).filter((file) =>
  file.endsWith(".clip.json"),
);

let vrm0: VRM;
let vrm1: VRM;
beforeAll(async () => {
  vrm0 = await loadTestAvatar("AvatarSample_Y_0");
  vrm1 = await loadTestAvatar("AvatarSample_A_1_New");
});

describe("example clips", () => {
  it("includes the six evaluation Gestures", () => {
    expect(examples.length).toBeGreaterThanOrEqual(6);
  });

  it.each(examples)(
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
