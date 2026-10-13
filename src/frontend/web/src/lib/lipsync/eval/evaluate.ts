/**
 * Runs plan sources over evaluation clips in each arrival mode and summarises
 * the scores per clip set, with held-out clips reported separately. Clips with
 * no scoring group are skipped.
 */

import {
  ARRIVAL_MODES,
  runPlanSource,
  type ArrivalModeName,
  type EvalPlanSource,
} from "./arrival";
import type { EvalClip, EvalSet } from "./clip";
import {
  formatSummaryTable,
  scoreRun,
  summarise,
  wordDrift,
  type EvalSummary,
  type ScoredClip,
} from "./report";

export const EVAL_SETS: EvalSet[] = ["main", "eleven-http", "eleven-socket"];

export type EvaluationRow = {
  source: string;
  label: string;
  mode: ArrivalModeName;
  set: EvalSet;
  heldOut: boolean;
  summary: EvalSummary;
  clips: ScoredClip[];
};

export function evaluate(
  clips: EvalClip[],
  sources: EvalPlanSource[],
  modes: ArrivalModeName[],
): EvaluationRow[] {
  for (const mode of modes) {
    if (!Object.hasOwn(ARRIVAL_MODES, mode)) {
      throw new Error(
        `Unknown arrival mode "${mode}"; use ${Object.keys(ARRIVAL_MODES).join(", ")}`,
      );
    }
  }
  const scoredClips = clips.filter((clip) => clip.groups.length > 0);
  // Whole-clip runs, the reference for progressive runs' word drift.
  const wholeRuns = new Map<string, ReturnType<typeof runPlanSource>>();
  const wholeRun = (source: EvalPlanSource, clip: EvalClip) => {
    const key = `${source.id}:${clip.id}`;
    let run = wholeRuns.get(key);
    if (!run) {
      run = runPlanSource(source, clip, ARRIVAL_MODES.whole);
      wholeRuns.set(key, run);
    }
    return run;
  };
  const rows: EvaluationRow[] = [];
  for (const source of sources) {
    for (const mode of modes) {
      if (mode !== "whole" && !source.progressive) continue;
      const scored = scoredClips.map((clip) => {
        const run = runPlanSource(source, clip, ARRIVAL_MODES[mode]);
        const result = scoreRun(clip, run);
        if (mode !== "whole" && run.words) {
          result.wordDriftSec = wordDrift(run, wholeRun(source, clip));
        }
        return result;
      });
      for (const heldOut of [false, true]) {
        for (const set of EVAL_SETS) {
          const selected = scored.filter(
            (s) => s.clip.set === set && s.clip.heldOut === heldOut,
          );
          if (!selected.length) continue;
          rows.push({
            source: source.id,
            label: source.label,
            mode,
            set,
            heldOut,
            summary: summarise(selected),
            clips: selected,
          });
        }
      }
    }
  }
  return rows;
}

export function formatEvaluation(rows: EvaluationRow[]): string {
  return formatSummaryTable(
    rows.map((row) => ({
      label: `${row.label} · ${row.mode} · ${row.set}${row.heldOut ? " · held out" : ""}`,
      summary: row.summary,
    })),
  );
}

/** A JSON-friendly copy of the rows, with per-clip scores. */
export function evaluationJson(rows: EvaluationRow[]) {
  return rows.map((row) => ({
    source: row.source,
    mode: row.mode,
    set: row.set,
    heldOut: row.heldOut,
    summary: row.summary,
    clips: row.clips.map(({ clip, score, run, wordDriftSec }) => ({
      id: clip.id,
      ...score,
      cpuMs: Number(run.cpuMs.toFixed(2)),
      wordDriftSec: wordDriftSec ?? null,
      events: run.track.events,
    })),
  }));
}
