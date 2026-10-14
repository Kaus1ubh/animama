/**
 * Plans lip-sync for speech whose audio cannot be captured (browser speech)
 * from its text alone, for the lip-sync worker. The voice speaks a reply as a
 * series of utterances and reports when each starts and ends, and sometimes
 * where each word starts. Each utterance's units start where it did, at an
 * average speaking rate; reported word starts re-anchor them; and an utterance
 * that has ended stretches or shrinks after its last anchor to end with it.
 *
 * Times are seconds on the run clock, from the first utterance's start.
 */

import { estimateUnitTimes } from "./align/estimate";
import type { AlignedUnit } from "./align/aligner";
import { speechGestureTiming } from "./render/beats";
import { renderAlignedUnits } from "./render/render";
import { createRunUpdateEmitter, type RunPlanUpdate } from "./run-planner";
import { detectHanLanguage, textToUnits } from "./text/text-units";
import type { LipSyncUnit } from "./text/units";

export type EstimateRunPlanner = {
  startUtterance: (text: string, sec: number) => void;
  /** The voice started the word at `charIndex` of the current utterance. */
  addBoundary: (charIndex: number, sec: number) => void;
  endUtterance: (sec: number) => void;
};

type Utterance = {
  units: LipSyncUnit[];
  startSec: number;
  endSec: number | null;
  /** Reported word starts, by the utterance's own word index. */
  wordStarts: Map<number, number>;
  /** Words in earlier utterances, so word indices stay unique in the run. */
  wordOffset: number;
};

/**
 * Units of `utterance`, stretched or shrunk after its last anchor so its last
 * spoken unit ends at `endSec`; trailing pauses end there too.
 */
function fitUtterance(utterance: Utterance, endSec: number): AlignedUnit[] {
  const placed = estimateUnitTimes(utterance.units, {
    startSec: utterance.startSec,
    wordStarts: utterance.wordStarts,
  });
  const spoken = placed.filter(
    ({ unit }) => unit.kind !== "pause" && unit.kind !== "tag",
  );
  const estimatedEnd = spoken.at(-1)?.endSec ?? utterance.startSec;
  const pivot = Math.min(
    Math.max(utterance.startSec, ...utterance.wordStarts.values()),
    estimatedEnd,
  );
  const scale =
    estimatedEnd - pivot > 1e-3 && endSec > pivot
      ? (endSec - pivot) / (estimatedEnd - pivot)
      : 1;
  const at = (sec: number) =>
    Math.min(endSec, sec <= pivot ? sec : pivot + (sec - pivot) * scale);
  return placed.map((unit) => ({
    ...unit,
    startSec: at(unit.startSec),
    endSec: at(unit.endSec),
  }));
}

export function createEstimateRunPlanner(options: {
  hanLanguage?: "ja" | "zh";
  onUpdate: (update: RunPlanUpdate) => void;
}): EstimateRunPlanner {
  const utterances: Utterance[] = [];
  /** All utterances' text, to decide how Han characters read (R2). */
  let replyText = "";
  const emit = createRunUpdateEmitter(options.onUpdate);
  let cpuMs = 0;

  const plan = () => {
    const started = performance.now();
    const aligned: AlignedUnit[] = [];
    utterances.forEach((utterance, index) => {
      const endSec = utterance.endSec ?? utterances[index + 1]?.startSec;
      const placed =
        endSec === undefined
          ? estimateUnitTimes(utterance.units, {
              startSec: utterance.startSec,
              wordStarts: utterance.wordStarts,
            })
          : fitUtterance(utterance, endSec);
      for (const unit of placed) {
        aligned.push(
          unit.unit.word === undefined
            ? unit
            : {
                ...unit,
                unit: {
                  ...unit.unit,
                  word: unit.unit.word + utterance.wordOffset,
                },
              },
        );
      }
    });
    const last = utterances.at(-1);
    const durationSec = Math.max(
      last?.endSec ?? 0,
      aligned.at(-1)?.endSec ?? 0,
    );
    const complete = Boolean(last && last.endSec !== null);
    const track = renderAlignedUnits(aligned, durationSec, null);
    const gestures = speechGestureTiming(aligned, null);
    cpuMs += performance.now() - started;
    emit({
      track,
      gestures,
      complete,
      fallback: null,
      audioSec: durationSec,
      cpuMs,
    });
  };

  return {
    startUtterance: (text, sec) => {
      const previous = utterances.at(-1);
      if (previous && previous.endSec === null) previous.endSec = sec;
      const wordOffset = previous
        ? previous.wordOffset +
          previous.units.reduce(
            (count, unit) => Math.max(count, (unit.word ?? -1) + 1),
            0,
          )
        : 0;
      replyText += `${text} `;
      utterances.push({
        units: textToUnits(text, {
          hanLanguage: options.hanLanguage ?? detectHanLanguage(replyText),
        }),
        startSec: sec,
        endSec: null,
        wordStarts: new Map(),
        wordOffset,
      });
      plan();
    },
    addBoundary: (charIndex, sec) => {
      const utterance = utterances.at(-1);
      if (!utterance || utterance.endSec !== null) return;
      const unit = utterance.units.find(
        (candidate) =>
          candidate.word !== undefined && candidate.end > charIndex,
      );
      if (!unit || utterance.wordStarts.has(unit.word!)) return;
      utterance.wordStarts.set(unit.word!, sec);
      plan();
    },
    endUtterance: (sec) => {
      const utterance = utterances.at(-1);
      if (!utterance || utterance.endSec !== null) return;
      utterance.endSec = sec;
      plan();
    },
  };
}
