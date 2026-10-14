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
import { sliceSpeechFeatures } from "@/lib/lipsync/audio/features";
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
      // A clip joined from parts is planned part by part, as in the app.
      const parts = windowed ? clip.parts : undefined;
      const planner = createLipSyncPlanner({
        text: parts ? "" : clip.text,
        windowed,
      });
      let nextPart = 0;
      return ({ features, timing, complete }) => {
        const frames = features.loudnessDb.length;
        for (; parts && nextPart < parts.length; nextPart += 1) {
          const part = parts[nextPart]!;
          const start = Math.round(part.startSec * features.rate);
          if (start > frames) break;
          planner.startPart(part.text, sliceSpeechFeatures(features, start));
        }
        const plan = planner.plan({ features, timing, complete });
        return {
          ...plan.track,
          words: plan.gestures.words.map(({ wordIndex, startSec }) => ({
            wordIndex,
            startSec,
          })),
        };
      };
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
