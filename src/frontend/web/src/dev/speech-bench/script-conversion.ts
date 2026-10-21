import { Converter } from "opencc-js/cn2t";

import type { BenchClip, BenchClipResult } from "./bench-protocol";

let toTraditional: ((text: string) => string) | null = null;

/**
 * Put a clip's result in the set's script. Traditional sets (`zh-Hant`, `yue`)
 * get the engine's Simplified output converted with OpenCC's Taiwan standard,
 * as the app would show `zh-Hant`, keeping the raw output; a Simplified
 * reference (`referenceScript: "Hans"`) is converted the same way.
 */
export function inSetScript(
  clip: BenchClip,
  result: BenchClipResult,
): BenchClipResult {
  if (clip.script !== "Hant") return result;
  toTraditional ??= Converter({ from: "cn", to: "tw" });
  return {
    ...result,
    rawText: result.text,
    text: toTraditional(result.text),
    ...(clip.referenceScript === "Hans"
      ? { reference: toTraditional(clip.text) }
      : {}),
  };
}
