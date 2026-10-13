/**
 * Summaries of scored clips, by clip set, arrival mode and plan source, in the
 * shape of the spec's acceptance criteria.
 */

import type { EvalRun } from "./arrival";
import type { EvalClip, EvalGroup } from "./clip";
import { scoreClip, type ClipScore } from "./metrics";

/** A tag counts as placed at an intersection-over-union of 0.5 or more. */
export const TAG_PLACED_IOU = 0.5;

export type ScoredClip = {
  clip: EvalClip;
  score: ClipScore;
  run: EvalRun;
};

export type EvalSummary = {
  clips: number;
  /** Mean vowel match over Japanese, Korean and Chinese clips. */
  vowelMatchCjk: number | null;
  /** Mean vowel match over Japanese, Korean, Chinese and Spanish clips (the brief's figure). */
  vowelMatchCjkEs: number | null;
  /** Mean open-in-silence over English clips without tags. */
  openInSilenceEnglish: number | null;
  /** Mean open-in-silence over tag lines. */
  openInSilenceTags: number | null;
  tagsPlaced: number;
  tagsTotal: number;
  corr: number | null;
  /** Median planning CPU per second of audio. */
  cpuMsPerAudioSec: number | null;
};

export function scoreRun(clip: EvalClip, run: EvalRun): ScoredClip {
  return { clip, score: scoreClip(run.track, clip), run };
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const inGroup = (scored: ScoredClip, group: EvalGroup) =>
  scored.clip.groups.includes(group);
const isCjk = (scored: ScoredClip) =>
  ["ja", "ko", "zh"].includes(scored.clip.lang);

export function summarise(scored: ScoredClip[]): EvalSummary {
  let tagsPlaced = 0;
  let tagsTotal = 0;
  for (const item of scored) {
    const placed = item.score.tagIous.filter(
      (iou) => iou >= TAG_PLACED_IOU,
    ).length;
    tagsPlaced += Math.min(placed, item.clip.intervalTags);
    tagsTotal += item.clip.intervalTags;
  }
  return {
    clips: scored.length,
    vowelMatchCjk: mean(scored.filter(isCjk).map((s) => s.score.vowelMatch)),
    vowelMatchCjkEs: mean(
      scored
        .filter((s) => isCjk(s) || s.clip.lang === "es")
        .map((s) => s.score.vowelMatch),
    ),
    openInSilenceEnglish: mean(
      scored
        .filter((s) => inGroup(s, "english"))
        .map((s) => s.score.openInSilence),
    ),
    openInSilenceTags: mean(
      scored
        .filter((s) => inGroup(s, "tags"))
        .map((s) => s.score.openInSilence),
    ),
    tagsPlaced,
    tagsTotal,
    corr: mean(scored.map((s) => s.score.corr)),
    cpuMsPerAudioSec: median(
      scored
        .filter((s) => s.clip.durationSec > 0)
        .map((s) => s.run.cpuMs / s.clip.durationSec),
    ),
  };
}

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

export type SummaryRow = { label: string; summary: EvalSummary };

/** A fixed-width table of summaries, one row per label. */
export function formatSummaryTable(rows: SummaryRow[]): string {
  const header = [
    "source / mode",
    "clips",
    "vowel ja/ko/zh",
    "+es",
    "silence en",
    "silence tags",
    "tags",
    "corr",
    "ms/s",
  ];
  const body = rows.map(({ label, summary }) => [
    label,
    String(summary.clips),
    percent(summary.vowelMatchCjk),
    percent(summary.vowelMatchCjkEs),
    percent(summary.openInSilenceEnglish),
    percent(summary.openInSilenceTags),
    summary.tagsTotal ? `${summary.tagsPlaced}/${summary.tagsTotal}` : "—",
    summary.corr === null ? "—" : summary.corr.toFixed(2),
    summary.cpuMsPerAudioSec === null
      ? "—"
      : summary.cpuMsPerAudioSec.toFixed(2),
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...body.map((row) => row[column]!.length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === 0
          ? cell.padEnd(widths[column]!)
          : cell.padStart(widths[column]!),
      )
      .join("  ");
  return [line(header), ...body.map(line)].join("\n");
}
