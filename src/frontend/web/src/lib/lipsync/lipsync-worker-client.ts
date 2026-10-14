/**
 * The app's side of the lip-sync worker: one shared worker, and a handle per
 * run that forwards the run's text, audio and timing and receives its plans.
 */

import { createLogger } from "@/lib/logger";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import type {
  LipSyncWorkerRequest,
  LipSyncWorkerResponse,
} from "./worker-protocol";

const logger = createLogger("LipSyncWorkerClient");

type RunListener = (response: LipSyncWorkerResponse) => void;

export type LipSyncRunHandle = {
  setText: (text: string, final: boolean) => void;
  /** A speech part starts with the next audio, speaking `text`. */
  startPart: (text: string) => void;
  /** A chunk of played audio; it is copied, as players keep the original. */
  pushPcm: (pcm: Float32Array | Int16Array) => void;
  addTiming: (chars: readonly TimedChar[]) => void;
  endAudio: () => void;
  /** Stop planning the run; later responses for it are dropped. */
  cancel: () => void;
};

let worker: Worker | null = null;
const listeners = new Map<string, RunListener>();

function getWorker(): Worker | null {
  if (worker) return worker;
  // Some environments (tests, server rendering) have no workers: lip-sync then
  // has no plans, and the mouth stays at rest.
  if (typeof Worker === "undefined") return null;
  const created = new Worker(
    new URL("../../workers/lipsync-worker.ts", import.meta.url),
    { type: "module", name: "lipsync-worker" },
  );
  created.addEventListener(
    "message",
    (event: MessageEvent<LipSyncWorkerResponse>) => {
      listeners.get(event.data.runId)?.(event.data);
    },
  );
  created.addEventListener("error", (event) => {
    logger.error("Worker", "Lip-sync worker error", {
      message: event.message,
    });
    // Runs in flight lose their plans; later runs start a fresh worker.
    for (const [runId, listener] of listeners) {
      listener({
        type: "error",
        runId,
        message: event.message || "worker error",
      });
    }
    listeners.clear();
    created.terminate();
    if (worker === created) worker = null;
  });
  worker = created;
  return created;
}

/** Register a run's listener, with a sender that stops once it is cancelled. */
function openRun(runId: string, onResponse: RunListener) {
  const target = getWorker();
  listeners.set(runId, onResponse);
  let active = true;
  return {
    isActive: () => active,
    send: (message: LipSyncWorkerRequest, transfer: Transferable[] = []) => {
      if (active) target?.postMessage(message, transfer);
    },
    cancel: () => {
      if (!active) return;
      target?.postMessage({ type: "cancel", runId });
      active = false;
      if (listeners.get(runId) === onResponse) listeners.delete(runId);
    },
  };
}

export type LipSyncEstimateRunHandle = {
  /** Times are seconds on the run clock, from the first utterance's start. */
  startUtterance: (text: string, sec: number) => void;
  addBoundary: (charIndex: number, sec: number) => void;
  endUtterance: (sec: number) => void;
  cancel: () => void;
};

/** Start planning a run from its utterances' text (browser speech). */
export function startLipSyncEstimateRun(args: {
  runId: string;
  onResponse: RunListener;
}): LipSyncEstimateRunHandle {
  const { runId } = args;
  const run = openRun(runId, args.onResponse);
  run.send({ type: "start_estimate", runId });
  return {
    startUtterance: (text, sec) =>
      run.send({ type: "utterance_start", runId, text, sec }),
    addBoundary: (charIndex, sec) =>
      run.send({ type: "utterance_boundary", runId, charIndex, sec }),
    endUtterance: (sec) => run.send({ type: "utterance_end", runId, sec }),
    cancel: run.cancel,
  };
}

/** Start planning a run; responses go to `onResponse` until it is cancelled. */
export function startLipSyncRun(args: {
  runId: string;
  sampleRate: number;
  onResponse: RunListener;
}): LipSyncRunHandle {
  const { runId } = args;
  const run = openRun(runId, args.onResponse);
  const { send } = run;
  send({ type: "start", runId, sampleRate: args.sampleRate });
  return {
    setText: (text, final) => send({ type: "text", runId, text, final }),
    startPart: (text) => send({ type: "part", runId, text }),
    pushPcm: (pcm) => {
      if (!run.isActive() || !pcm.length) return;
      const copy = pcm.slice();
      send({ type: "pcm", runId, pcm: copy }, [copy.buffer]);
    },
    addTiming: (chars) => {
      if (chars.length) send({ type: "timing", runId, chars: [...chars] });
    },
    endAudio: () => send({ type: "end_audio", runId }),
    cancel: run.cancel,
  };
}

/** Stop the worker (session reset); runs still planning fall back. */
export function terminateLipSyncWorker(): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  listeners.clear();
}
