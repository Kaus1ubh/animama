/// <reference lib="webworker" />

/**
 * Plans lip-sync off the main thread: one progressive planner per run, fed the
 * run's text, audio and provider timing as they arrive, or an estimate from
 * the text for speech without capturable audio. The English dictionary loads
 * once, before the first run is planned; the Chinese readings load the first
 * time a run's text has Han characters read as Chinese.
 */

import { loadChineseReadings } from "@/lib/lipsync/text/converters";
import { loadEnglishDictionary } from "@/lib/lipsync/text/english-dictionary";
import { detectHanLanguage } from "@/lib/lipsync/text/text-units";
import {
  createEstimateRunPlanner,
  type EstimateRunPlanner,
} from "@/lib/lipsync/estimate-run";
import {
  createLipSyncRunPlanner,
  type LipSyncRunPlanner,
  type RunPlanUpdate,
} from "@/lib/lipsync/run-planner";
import type {
  LipSyncWorkerRequest,
  LipSyncWorkerResponse,
} from "@/lib/lipsync/worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const runs = new Map<string, LipSyncRunPlanner>();
const estimateRuns = new Map<string, EstimateRunPlanner>();

// English is needed for most replies. Until a dictionary loads (or if it
// fails), its words fall back to letter rules and Han characters to unknown
// vowels timed by the audio.
const ready = loadEnglishDictionary().catch(() => undefined);

const HAN = /\p{Script=Han}/u;
let chineseReadings: Promise<void> | null = null;

/** Load the Chinese readings before a message whose text needs them. */
function readingsFor(message: LipSyncWorkerRequest): Promise<void> | null {
  const text =
    message.type === "text" ||
    message.type === "part" ||
    message.type === "utterance_start"
      ? message.text
      : null;
  if (!text || !HAN.test(text) || detectHanLanguage(text) !== "zh") return null;
  chineseReadings ??= loadChineseReadings().catch(() => {
    // A later Chinese text tries again.
    chineseReadings = null;
  });
  return chineseReadings;
}

function post(message: LipSyncWorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

const postPlan = (runId: string) => (update: RunPlanUpdate) =>
  post({ type: "plan", runId, ...update }, [update.frames.buffer]);

function handle(message: LipSyncWorkerRequest): void {
  if (message.type === "start") {
    estimateRuns.delete(message.runId);
    runs.set(
      message.runId,
      createLipSyncRunPlanner({
        sampleRate: message.sampleRate,
        onUpdate: postPlan(message.runId),
      }),
    );
    return;
  }
  if (message.type === "start_estimate") {
    runs.delete(message.runId);
    estimateRuns.set(
      message.runId,
      createEstimateRunPlanner({
        onUpdate: postPlan(message.runId),
      }),
    );
    return;
  }
  if (message.type === "cancel") {
    runs.delete(message.runId);
    estimateRuns.delete(message.runId);
    return;
  }
  const estimate = estimateRuns.get(message.runId);
  if (estimate) {
    if (message.type === "utterance_start")
      estimate.startUtterance(message.text, message.sec);
    else if (message.type === "utterance_boundary")
      estimate.addBoundary(message.charIndex, message.sec);
    else if (message.type === "utterance_end")
      estimate.endUtterance(message.sec);
    return;
  }
  const run = runs.get(message.runId);
  if (!run) return;
  switch (message.type) {
    case "text":
      run.setText(message.text, message.final);
      break;
    case "part":
      run.startPart(message.text);
      break;
    case "pcm":
      run.pushPcm(message.pcm);
      break;
    case "timing":
      run.addTiming(message.chars);
      break;
    case "end_audio":
      run.endAudio();
      break;
  }
}

// Messages are handled in order, each after any data it needs.
let queue: Promise<void> = ready;
scope.addEventListener(
  "message",
  (event: MessageEvent<LipSyncWorkerRequest>) => {
    const message = event.data;
    queue = queue.then(async () => {
      await readingsFor(message);
      try {
        handle(message);
      } catch (error) {
        runs.delete(message.runId);
        estimateRuns.delete(message.runId);
        post({
          type: "error",
          runId: message.runId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
  },
);
