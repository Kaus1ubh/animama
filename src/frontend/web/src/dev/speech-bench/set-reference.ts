import { toTraditional } from "@/lib/speech/client-sensevoice/script";

import type { BenchClip, BenchClipResult } from "./bench-protocol";

/**
 * Give a result the reference it is scored against: a set whose reference is
 * Simplified but is scored in Traditional script (`zh-Hant` on the Mainland
 * clips) gets the reference converted the way the app converts its output.
 */
export async function withSetReference(
  clip: BenchClip,
  result: BenchClipResult,
): Promise<BenchClipResult> {
  return clip.script === "Hant" && clip.referenceScript === "Hans"
    ? { ...result, reference: await toTraditional(clip.text) }
    : result;
}
