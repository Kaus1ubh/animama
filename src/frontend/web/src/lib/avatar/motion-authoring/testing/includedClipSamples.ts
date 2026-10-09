import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { VRM } from "@pixiv/three-vrm";

import {
  parseAnimaPoseClip,
  type AnimaPoseClipSample,
} from "../../poses/animaPoseClip";
import { createAnimaPoseClipProgram } from "../../poses/animaPoseClip/program";
import { getResolvedAvatarPose } from "../../poses/catalog";

/**
 * Fingerprints of how Included Gesture clips play, for proving that untouched
 * clips sample identically after changes to the sampler, hand presets or
 * schema.
 */

/** A clip's file hash and, per Included Avatar, the hash of its samples. */
export type ClipSampleFingerprint = {
  fileSha256: string;
  samples: Record<string, string>;
};

export const INCLUDED_GESTURE_DIRECTORY = fileURLToPath(
  new URL(
    "../../../../../../../../content/included/gestures/",
    import.meta.url,
  ),
);

/** Slugs of Included Gestures with an animaPoseClip/2.0 file, sorted. */
export function includedGestureClipSlugs(): string[] {
  return readdirSync(INCLUDED_GESTURE_DIRECTORY)
    .filter((slug) => {
      const file = includedGestureClipPath(slug);
      // VRMA-only Gestures have no clip file.
      return (
        existsSync(file) &&
        JSON.parse(readFileSync(file, "utf8")).schema === "animaPoseClip/2.0"
      );
    })
    .sort();
}

export function includedGestureClipPath(slug: string): string {
  return `${INCLUDED_GESTURE_DIRECTORY}${slug}/${slug}.json`;
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Prepare an Included Gesture for each Avatar as playback does and hash its
 * samples at every 0.1 s from 0 to the duration, at the duration, and at the
 * end of the cycle (which a loop would otherwise wrap to its start).
 */
export function fingerprintIncludedClip(
  slug: string,
  avatars: readonly { id: string; vrm: VRM }[],
): ClipSampleFingerprint {
  const bytes = readFileSync(includedGestureClipPath(slug));
  const clip = parseAnimaPoseClip(JSON.parse(bytes.toString("utf8")));
  const times: number[] = [];
  for (let tenth = 0; tenth / 10 <= clip.duration + 1e-9; tenth += 1)
    times.push(tenth / 10);
  times.push(clip.duration);
  const samples: Record<string, string> = {};
  for (const { id, vrm } of avatars) {
    const program = createAnimaPoseClipProgram(clip, {
      vrm,
      resolvePose: resolveCatalogPose,
    });
    const frames = times.map((time) => quantize(program.sample(time).sample));
    frames.push(quantize(program.sample(0, { atEnd: true }).sample));
    samples[id] = sha256(JSON.stringify(frames));
  }
  return { fileSha256: sha256(bytes), samples };
}

/** Resolve pose references the way playback does: from the app catalog. */
function resolveCatalogPose(id: string) {
  try {
    return getResolvedAvatarPose(id);
  } catch {
    return null;
  }
}

/**
 * A sample as sorted entries of integers: humanoid rotations in steps of 1e-5
 * (sign-normalized so `w ≥ 0`), positions in 1e-6 m and expression weights in
 * 1e-4, so the hash ignores floating-point noise below those steps.
 */
function quantize({ humanoid = {}, expressions = {} }: AnimaPoseClipSample) {
  const round = (values: readonly number[], step: number) =>
    values.map((value) => Math.round(value / step));
  return {
    humanoid: sortedEntries(humanoid).map(([bone, { rotation, position }]) => [
      bone,
      rotation
        ? round(
            rotation[3] < 0 ? rotation.map((value) => -value) : rotation,
            1e-5,
          )
        : null,
      position ? round(position, 1e-6) : null,
    ]),
    expressions: sortedEntries(expressions).map(([name, weight]) => [
      name,
      Math.round(weight / 1e-4),
    ]),
  };
}

function sortedEntries<T>(record: Partial<Record<string, T>>): [string, T][] {
  return (Object.entries(record) as [string, T][]).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}
