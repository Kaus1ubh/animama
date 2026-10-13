/**
 * The new planner as evaluation sources: text units aligned to the arriving
 * audio, guided by provider timing where the clip has it.
 *
 * - `aligned`: progressive, re-aligning only the newest audio, as in the app;
 * - `aligned-full`: re-aligns everything on every step, a reference for the
 *   windowed planner's accuracy and cost (opt-in, as it is slow on long lines).
 */

import { loadChineseReadings } from "@/lib/lipsync/text/converters";
import { loadEnglishDictionary } from "@/lib/lipsync/text/english-dictionary";
import { createLipSyncPlanner } from "@/lib/lipsync/planner";
import type { EvalPlanSource } from "./arrival";

const prepare = async () => {
  await Promise.all([loadEnglishDictionary(), loadChineseReadings()]);
};

function alignedSource(
  id: string,
  label: string,
  windowed: boolean,
): EvalPlanSource {
  return {
    id,
    label,
    progressive: true,
    optIn: !windowed,
    prepare,
    start: (clip) => {
      const planner = createLipSyncPlanner({ text: clip.text, windowed });
      return ({ features, timing, complete }) =>
        planner.plan({ features, timing, complete }).track;
    },
  };
}

export const alignedEvalSource = alignedSource(
  "aligned",
  "Aligned (new)",
  true,
);
export const alignedFullEvalSource = alignedSource(
  "aligned-full",
  "Aligned, full re-align",
  false,
);
