/**
 * Builds an evaluation clip from a recorded line: its PCM, the provider timing
 * recorded with it, its forced-alignment reference and today's planner inputs.
 * Used by `pnpm lipsync:fixtures`; the PCM is reduced to features here.
 */

import { analyseSpeechAudio } from "@/lib/lipsync/audio/features";
import {
  createSpeechTimingCollector,
  type TimedChar,
} from "@/lib/speech/provider-speech-timing";
import type { EstimatedPlannerInputs, EvalClip, EvalClipMeta } from "./clip";
import { referenceFromAlignment, type AlignedWord } from "./reference";

/** Text to Dialogue socket messages as recorded: audio sample counts, alignment and turn ends. */
export type RecordedSocketMessage = {
  samples: number;
  alignment: unknown;
  is_final_audio_for_turn?: boolean;
  is_final?: boolean;
};

/** HTTP timing as recorded: characters with start and end seconds from the clip's start. */
export type RecordedHttpAlignment = {
  characters: string[];
  starts: number[];
  ends: number[];
};

export type RecordedTiming =
  | { kind: "socket"; sampleRate: number; messages: RecordedSocketMessage[] }
  | { kind: "http"; alignment: RecordedHttpAlignment };

/** Place recorded timing on the clip clock, the way the app's collector does for the socket. */
export function timingFromRecording(recording: RecordedTiming): TimedChar[] {
  if (recording.kind === "http") {
    const { characters, starts, ends } = recording.alignment;
    return characters.map((char, index) => ({
      char,
      startSec: starts[index]!,
      endSec: ends[index]!,
    }));
  }
  const collector = createSpeechTimingCollector(recording.sampleRate);
  const timeline: TimedChar[] = [];
  for (const message of recording.messages) {
    collector.acceptAudio(message.samples);
    if (message.alignment)
      timeline.push(...collector.acceptDialogueAlignment(message.alignment));
    if (message.is_final_audio_for_turn) collector.endTurn();
  }
  return timeline;
}

export function buildEvalClip(input: {
  meta: EvalClipMeta;
  pcm: Float32Array | Int16Array;
  sampleRate: number;
  timing: RecordedTiming | null;
  alignment: AlignedWord[];
  estimated: EstimatedPlannerInputs | null;
}): EvalClip {
  return {
    ...input.meta,
    durationSec: input.pcm.length / input.sampleRate,
    sampleRate: input.sampleRate,
    features: analyseSpeechAudio(input.pcm, input.sampleRate),
    timing: input.timing ? timingFromRecording(input.timing) : null,
    reference: referenceFromAlignment(input.alignment, input.meta.lang),
    estimated: input.estimated,
  };
}
