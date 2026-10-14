import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { VRM } from "@pixiv/three-vrm";
import { beforeAll, describe, expect, it } from "vitest";

import { INCLUDED_AVATAR_FILES, type IncludedAvatarId } from "./headlessVrm";
import { loadTestAvatar } from "./testing/includedAvatars";
import {
  fingerprintIncludedClip,
  includedGestureClipPath,
  includedGestureClipSlugs,
  sha256,
  type ClipSampleFingerprint,
} from "./testing/includedClipSamples";

/**
 * Untouched Included Gestures must play exactly as recorded in the baseline on
 * both Included Avatars, whatever changes in the sampler, hand presets or
 * schema. The baseline was generated from `main` at bfc0de4f and re-recorded
 * after the #314 and #409 Gesture revisions, additions and removals were
 * promoted, and after the #543 effect merge rewrote the effect events of 28
 * Gestures (their samples were unchanged).
 *
 * A clip changed on purpose is listed in REBASELINED, which skips its samples;
 * one deleted on purpose is listed in REMOVED. Clips missing from the baseline
 * are not compared. To record new and revised clips, run (from
 * `src/frontend/web`)
 *
 *   UPDATE_CLIP_BASELINE=1 pnpm exec vitest run src/lib/avatar/motion-authoring/includedClipBaseline.test.ts
 *
 * which refuses while an unlisted clip differs from the baseline, then
 * rewrites the baseline from the current clips; empty both sets afterwards.
 */

/** Included Gestures revised on purpose since the baseline. */
const REBASELINED = new Set<string>([]);
/** Included Gestures deleted on purpose since the baseline. */
const REMOVED = new Set<string>([]);

const UPDATE = process.env.UPDATE_CLIP_BASELINE === "1";
const BASELINE_FILE = fileURLToPath(
  new URL("./testing/included-clip-sample-baseline.json", import.meta.url),
);
const baseline: Record<string, ClipSampleFingerprint> =
  UPDATE && !existsSync(BASELINE_FILE)
    ? {}
    : JSON.parse(readFileSync(BASELINE_FILE, "utf8"));

const fileSha256 = (slug: string) =>
  sha256(readFileSync(includedGestureClipPath(slug)));

let avatars: { id: IncludedAvatarId; vrm: VRM }[];
beforeAll(async () => {
  avatars = await Promise.all(
    (Object.keys(INCLUDED_AVATAR_FILES) as IncludedAvatarId[]).map(
      async (id) => ({ id, vrm: await loadTestAvatar(id) }),
    ),
  );
});

describe("Included Gesture sample baseline", () => {
  it("lists only clips that changed or were removed", () => {
    const exists = (slug: string) => existsSync(includedGestureClipPath(slug));
    expect(
      [...REBASELINED].filter(
        (slug) =>
          !baseline[slug] ||
          !exists(slug) ||
          fileSha256(slug) === baseline[slug].fileSha256,
      ),
      "REBASELINED clips must exist and differ from the baseline",
    ).toEqual([]);
    expect(
      [...REMOVED].filter((slug) => !baseline[slug] || exists(slug)),
      "REMOVED clips must be in the baseline and deleted",
    ).toEqual([]);
  });

  it.each(Object.keys(baseline))(
    "%s samples as at the baseline",
    (slug) => {
      if (REMOVED.has(slug) || REBASELINED.has(slug)) return;
      expect(
        existsSync(includedGestureClipPath(slug)),
        `${slug} was deleted: list it in REMOVED`,
      ).toBe(true);
      expect(
        fileSha256(slug),
        `${slug} changed: restore it or list it in REBASELINED`,
      ).toBe(baseline[slug].fileSha256);
      expect(fingerprintIncludedClip(slug, avatars).samples).toEqual(
        baseline[slug].samples,
      );
    },
    60000,
  );

  it.runIf(UPDATE)(
    "records new and revised clips",
    () => {
      const current = Object.fromEntries(
        includedGestureClipSlugs().map((slug) => [
          slug,
          fingerprintIncludedClip(slug, avatars),
        ]),
      );
      expect(
        Object.keys(baseline).filter(
          (slug) =>
            !REBASELINED.has(slug) &&
            !REMOVED.has(slug) &&
            !isDeepStrictEqual(current[slug], baseline[slug]),
        ),
        "unlisted clips differ from the baseline",
      ).toEqual([]);
      writeFileSync(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`);
    },
    600000,
  );
});
