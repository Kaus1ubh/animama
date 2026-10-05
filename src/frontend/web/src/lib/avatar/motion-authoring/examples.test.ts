import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM } from "@pixiv/three-vrm";
import { beforeAll, describe, expect, it } from "vitest";

import { bakeMotion } from "./bake";
import { checkMotion } from "./checks";
import { parseMotionDescription } from "./description";
import { loadTestAvatar } from "./testing/includedAvatars";

/**
 * Every committed example description (including the evaluation Gestures)
 * must still validate, bake within tolerance and pass the motion checks on
 * both Included Avatars.
 */
const directory = fileURLToPath(new URL("./examples/", import.meta.url));
const examples = readdirSync(directory).filter((file) =>
  file.endsWith(".motion.json"),
);

let vrm0: VRM;
let vrm1: VRM;
beforeAll(async () => {
  vrm0 = await loadTestAvatar("AvatarSample_Y_0");
  vrm1 = await loadTestAvatar("AvatarSample_A_1_New");
});

describe("motion description examples", () => {
  it.each(examples)(
    "%s generates and passes the checks",
    (file) => {
      const parsed = parseMotionDescription(
        JSON.parse(readFileSync(directory + file, "utf8")),
      );
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const { clip, report } = bakeMotion(parsed.description, vrm1);
      expect(report.withinTolerance).toBe(true);
      const checks = checkMotion(
        clip,
        [
          { id: "AvatarSample_Y_0", vrm: vrm0 },
          { id: "AvatarSample_A_1_New", vrm: vrm1 },
        ],
        {
          contacts: parsed.description.contacts,
          plantFeet: parsed.description.plantFeet !== false,
        },
      );
      expect(checks.findings.filter((f) => f.severity === "fail")).toEqual([]);
    },
    30000,
  );
});
