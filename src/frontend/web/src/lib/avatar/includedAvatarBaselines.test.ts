import { describe, expect, it } from "vitest";

import {
  VRM0_FIXTURE_ID,
  type TestAvatarId,
} from "./motion-authoring/testing/includedAvatars";
import { loadedTestAvatar } from "./testing/loadedTestAvatar";

/**
 * Generalizing face-part detection, landmarks and texture anchors for other
 * models must leave the Included Avatars (and the VRM 0 fixture) exactly as
 * they are. These committed baselines hold what each loads with today; a
 * deliberate change updates them with `npx vitest run -u` and is reviewed in
 * the diff.
 */
const BASELINE_AVATARS: readonly TestAvatarId[] = [
  "Andrew",
  "AvatarSample_A_1_New",
  VRM0_FIXTURE_ID,
];

/** Round to micrometres so float noise between runtimes cannot fail the test. */
function rounded(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" && !Number.isInteger(item)
        ? Math.round(item * 1e6) / 1e6
        : item,
    ),
  );
}

describe("Included Avatar face baselines", () => {
  it.each(BASELINE_AVATARS)(
    "%s keeps its face parts, landmarks and texture anchors",
    async (id) => {
      const avatar = await loadedTestAvatar(id);
      const baseline = rounded({
        faceParts: avatar.facePartMap,
        landmarks: avatar.getFaceLandmarksSnapshot(),
        textureAnchors: avatar.getFaceTextureAnchorsSnapshot(),
      });
      await expect(
        `${JSON.stringify(baseline, null, 2)}\n`,
      ).toMatchFileSnapshot(`./testing/baselines/${id}.json`);
    },
  );
});
