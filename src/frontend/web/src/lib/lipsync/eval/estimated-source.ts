/**
 * Today's estimated planner as an evaluation source: gruut phonemes, estimated
 * durations and one rescale to the clip's length. It plans only once the whole
 * clip is known, like the planner's final pass in the app.
 */

import { buildGruutVisemeKeyframes } from "@/lib/speech/gruut-viseme-keyframes";
import { emptyLipSyncTrack, LIPSYNC_FPS } from "@/lib/lipsync/track";
import type { EvalPlanSource } from "./arrival";

export const estimatedEvalSource: EvalPlanSource = {
  id: "estimated",
  label: "Estimated (today)",
  progressive: false,
  plan: ({ clip }) => {
    const track = emptyLipSyncTrack(clip.durationSec);
    const inputs = clip.estimated;
    if (!inputs || !inputs.phonemizedText.length) return track;
    const plan = buildGruutVisemeKeyframes({
      phonemizedText: inputs.phonemizedText,
      tokenizedText: inputs.tokenizedText,
      fps: LIPSYNC_FPS,
      targetDurationSec: clip.durationSec,
    });
    if (!plan) return track;
    const count = track.frames.length / 5;
    for (const key of plan.keyframes) {
      if (key.frameIndex < 0 || key.frameIndex >= count) continue;
      track.frames.set([key.A, key.E, key.I, key.O, key.U], key.frameIndex * 5);
    }
    return track;
  },
};
