import { Mesh } from "three";
import { describe, it } from "vitest";

import { loadTestAvatarWithGltf } from "./motion-authoring/testing/includedAvatars";
import type { IncludedAvatarId } from "./motion-authoring/headlessVrm";
import { prepareTestAvatar } from "./testing/loadedTestAvatar";

/**
 * A reported measurement, not a threshold: the time of the load-time
 * correction path (the shared installs, face-part detection, landmarks and
 * texture anchors) on both Included Avatars, compared by hand between a
 * phase's start and end on the same machine. Run with
 * `ANIMAMA_AVATAR_LOAD_TIMING=1 npx vitest run src/lib/avatar/avatarLoadTiming.test.ts`.
 */
const AVATARS: readonly IncludedAvatarId[] = ["Andrew", "AvatarSample_A_1_New"];
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 5;

async function correctionMilliseconds(id: IncludedAvatarId): Promise<{
  milliseconds: number;
  primitives: number;
}> {
  // Parsing is three's work and outside the measurement: load first.
  const { vrm, gltf } = await loadTestAvatarWithGltf(id);
  let primitives = 0;
  vrm.scene.traverse((object) => {
    if (object instanceof Mesh) primitives += 1;
  });
  const start = performance.now();
  const avatar = await prepareTestAvatar(vrm, gltf, "c".repeat(64));
  avatar.getFaceTextureAnchorsSnapshot();
  return { milliseconds: performance.now() - start, primitives };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe.skipIf(!process.env.ANIMAMA_AVATAR_LOAD_TIMING)(
  "Avatar load-time corrections",
  () => {
    it("reports the median time per Included Avatar", async () => {
      const rows: string[] = [
        "avatar\tprimitives\tmedian ms\tms per primitive",
      ];
      for (const id of AVATARS) {
        const runs: number[] = [];
        let primitives = 0;
        for (let run = 0; run < WARMUP_RUNS + MEASURED_RUNS; run += 1) {
          const result = await correctionMilliseconds(id);
          primitives = result.primitives;
          if (run >= WARMUP_RUNS) runs.push(result.milliseconds);
        }
        const total = median(runs);
        rows.push(
          `${id}\t${primitives}\t${total.toFixed(2)}\t${(total / primitives).toFixed(3)}`,
        );
      }
      // Vitest captures console output; the report goes straight to stdout.
      process.stdout.write(`${rows.join("\n")}\n`);
    }, 120_000);
  },
);
