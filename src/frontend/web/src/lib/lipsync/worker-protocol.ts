/**
 * Messages between the app and the lip-sync worker (`workers/lipsync-worker.ts`).
 * Each run is planned independently; `cancel` ends one, and a new `start` for a
 * run id replaces it. Runs whose audio cannot be captured (browser speech)
 * start with `start_estimate` and are planned from their utterances' text.
 */

import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import type { RunPlanUpdate } from "./run-planner";

export type LipSyncWorkerRequest =
  | {
      type: "start";
      runId: string;
      sampleRate: number;
      /** How Han characters read, from the whole reply when known. */
      hanLanguage?: "ja" | "zh";
    }
  /** The text sent to the voice so far, tags included. */
  | { type: "text"; runId: string; text: string; final: boolean }
  /** A speech part starts with the next audio, speaking `text`. */
  | { type: "part"; runId: string; text: string }
  /** A chunk of the run's audio, as played (transferred). */
  | { type: "pcm"; runId: string; pcm: Float32Array | Int16Array }
  | { type: "timing"; runId: string; chars: TimedChar[] }
  | { type: "end_audio"; runId: string }
  | { type: "start_estimate"; runId: string; hanLanguage?: "ja" | "zh" }
  /** Times are seconds on the run clock, from the first utterance's start. */
  | { type: "utterance_start"; runId: string; text: string; sec: number }
  | {
      type: "utterance_boundary";
      runId: string;
      charIndex: number;
      sec: number;
    }
  | { type: "utterance_end"; runId: string; sec: number }
  | { type: "cancel"; runId: string };

export type LipSyncWorkerResponse =
  | ({ type: "plan"; runId: string } & RunPlanUpdate)
  | { type: "error"; runId: string; message: string };
