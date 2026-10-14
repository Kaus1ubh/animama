/**
 * The agreed thresholds (D2) for the new planner, scored progressively at each
 * provider's delivery rate: Gemini and Pocket (the main set) at 2.9× real time
 * and live, ElevenLabs at 2.9× and as a live stream with a 0.3 s buffer.
 *
 * Beyond D2, the tests guard against progressive plans drifting from the
 * speech, on every set and on multi-sentence replies made by joining tuning
 * clips: words must start about where planning the whole clip at once puts
 * them (word drift), and the mouth must open on reference vowels about as often.
 * Untimed speech with voiced sighs or laughs still drifts within a part
 * (recorded in the plan), so the bounds catch regressions rather than prove
 * there is no drift.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createLipSyncPlanner } from "@/lib/lipsync/planner";
import { alignedEvalSource } from "./aligned-source";
import { ARRIVAL_MODES, runPlanSource } from "./arrival";
import { decodeEvalClip, type EncodedEvalClip, type EvalClip } from "./clip";
import { evaluate, type EvaluationRow } from "./evaluate";
import { joinEvalClips } from "./join";
import { scoreClip } from "./metrics";
import { summarise, wordDrift } from "./report";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/lipsync/fixtures",
);

let clips: EvalClip[] = [];
let rows: EvaluationRow[] = [];

beforeAll(async () => {
  await alignedEvalSource.prepare!();
  clips = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) =>
      decodeEvalClip(
        JSON.parse(
          readFileSync(path.join(fixturesDir, file), "utf8"),
        ) as EncodedEvalClip,
      ),
    );
  rows = evaluate(clips, [alignedEvalSource], ["whole", "faster", "live"]);
}, 120_000);

type Mode = "whole" | "faster" | "live";

/** One summary over the rows that match, rescored together. */
function summary(mode: Mode, sets: readonly string[], heldOut: boolean) {
  return summarise(
    rows
      .filter(
        (row) =>
          row.mode === mode &&
          sets.includes(row.set) &&
          row.heldOut === heldOut,
      )
      .flatMap((row) => row.clips),
  );
}

const MAIN = ["main"] as const;
const ELEVEN = ["eleven-http", "eleven-socket"] as const;
/** Progressive plans may open on reference vowels this much less than whole ones. */
const DRIFT_ALLOWANCE = 0.05;
/** Mean word drift per set, and the most any one clip may drift, in seconds. */
const SET_WORD_DRIFT_SEC = 0.35;
const CLIP_WORD_DRIFT_SEC = 1.5;
/** Mean word drift of a joined multi-sentence reply, in seconds: one part, or in parts. */
const PART_WORD_DRIFT_SEC = 1.2;
const PARTS_WORD_DRIFT_SEC = 0.8;

describe("aligned planner thresholds (D2)", () => {
  it.each(["faster", "live"] as const)(
    "default tier, Gemini and Pocket, %s",
    (mode) => {
      const main = summary(mode, MAIN, false);
      expect(main.openInSilenceEnglish).not.toBeNull();
      expect(main.openInSilenceEnglish!).toBeLessThanOrEqual(0.1);
      expect(main.openInSilenceTags).toBeLessThanOrEqual(0.1);
      expect(main.vowelMatchCjk).toBeGreaterThanOrEqual(0.4);
    },
  );

  it.each(["faster", "live"] as const)("ElevenLabs with timing, %s", (mode) => {
    const eleven = summary(mode, ELEVEN, false);
    // English lines without tags are in the HTTP set only.
    expect(
      summary(mode, ["eleven-http"], false).openInSilenceEnglish,
    ).not.toBeNull();
    expect(eleven.openInSilenceEnglish!).toBeLessThanOrEqual(0.1);
    expect(eleven.openInSilenceTags).toBeLessThanOrEqual(0.1);
    expect(eleven.vowelMatchCjk).toBeGreaterThanOrEqual(0.6);
    expect(eleven.tagsPlaced / eleven.tagsTotal).toBeGreaterThanOrEqual(0.75);
  });

  it.each([
    ["faster", MAIN],
    ["live", MAIN],
    ["faster", ELEVEN],
    ["live", ELEVEN],
  ] as const)(
    "held-out clips are no more than 10 points worse (%s, %j)",
    (mode, sets) => {
      // Correlation and tags are reported, not tested: two held-out tags per
      // set cannot show a 10-point difference.
      const tuning = summary(mode, sets, false);
      const heldOut = summary(mode, sets, true);
      if (tuning.vowelMatchCjk !== null && heldOut.vowelMatchCjk !== null) {
        expect(heldOut.vowelMatchCjk).toBeGreaterThanOrEqual(
          tuning.vowelMatchCjk - 0.1,
        );
      }
      for (const key of [
        "openInSilenceEnglish",
        "openInSilenceTags",
      ] as const) {
        const a = tuning[key];
        const b = heldOut[key];
        if (a !== null && b !== null) {
          expect(b, key).toBeLessThanOrEqual(a + 0.1);
        }
      }
    },
  );
});

describe("progressive plans stay with the speech", () => {
  it.each(
    (["faster", "live"] as const).flatMap((mode) =>
      ["main", "eleven-http", "eleven-socket"].map(
        (set) => [mode, set] as const,
      ),
    ),
  )("%s, %s: words and vowels stay close to whole planning", (mode, set) => {
    const whole = summary("whole", [set], false).vowelOpen!;
    const progressive = summary(mode, [set], false);
    expect(progressive.vowelOpen!).toBeGreaterThanOrEqual(
      whole - DRIFT_ALLOWANCE,
    );
    expect(progressive.wordDriftSec!).toBeLessThanOrEqual(SET_WORD_DRIFT_SEC);
    // Held-out clips count here too: no clip may drift grossly.
    for (const heldOut of [false, true]) {
      const worst = summary(mode, [set], heldOut).maxWordDriftSec;
      if (worst !== null)
        expect(worst).toBeLessThanOrEqual(CLIP_WORD_DRIFT_SEC);
    }
  });

  // Gemini speaks a reply in parts, each planned against its own audio; Pocket
  // and ElevenLabs without timing speak it as one part.
  it.each([
    ["Gemini English", ["s-en", "g-en-long", "s-en-sad"], true],
    [
      "Gemini English with tags",
      ["g-en-laugh", "g-en-sigh", "g-en-pause", "g-en-whisper", "g-en-long"],
      true,
    ],
    [
      "Gemini tags in four languages",
      ["g-ko-sigh", "g-zh-laugh", "g-ja-laugh", "g-en-gasp", "g-en-laugh"],
      true,
    ],
    ["Gemini Japanese", ["s-ja", "s-ja-excited", "g-ja-laugh"], true],
    ["Pocket English", ["p-en", "p-en-long", "p-en-pause"], false],
    ["ElevenLabs English without timing", ["e-en", "e-en-long"], false],
  ] as const)("a multi-sentence reply: %s", (_name, ids, parts) => {
    const part = joinEvalClips(
      ids.map((id) => clips.find((clip) => clip.id === id)!),
      { parts },
    );
    const wholeRun = runPlanSource(
      alignedEvalSource,
      part,
      ARRIVAL_MODES.whole,
    );
    const whole = scoreClip(wholeRun.track, part).vowelOpen!;
    for (const mode of ["faster", "live"] as const) {
      const run = runPlanSource(alignedEvalSource, part, ARRIVAL_MODES[mode]);
      const score = scoreClip(run.track, part);
      expect(score.vowelOpen!, mode).toBeGreaterThanOrEqual(
        whole - DRIFT_ALLOWANCE,
      );
      expect(wordDrift(run, wholeRun)!, mode).toBeLessThanOrEqual(
        parts ? PARTS_WORD_DRIFT_SEC : PART_WORD_DRIFT_SEC,
      );
    }
  });
});

describe("beats against gruut's stress", () => {
  const VOWEL = /[aeiouæɑɒɔəɚɛɜɝɪʊʌ]/;

  it("fall mostly on syllables gruut stresses, in English", () => {
    // gruut's readings of each English line, kept in the fixtures from Phase 1.
    let beats = 0;
    let onStress = 0;
    for (const clip of clips) {
      if (clip.lang !== "en" || !clip.groups.length || !clip.estimated)
        continue;
      const gruutWords =
        clip.estimated.tokenizedText.match(/[\p{L}\p{N}'’]+/gu) ?? [];
      if (gruutWords.length !== clip.estimated.phonemizedText.length) continue;
      const gruut = clip.estimated.phonemizedText.map((phonemes, index) => {
        const vowels = phonemes.filter((phoneme) => VOWEL.test(phoneme));
        return {
          text: gruutWords[index]!.toLowerCase(),
          count: vowels.length,
          stressed: vowels.findIndex((phoneme) => phoneme.includes("ˈ")),
        };
      });
      const plan = createLipSyncPlanner({ text: clip.text }).plan({
        features: clip.features,
        timing: clip.timing,
        complete: true,
      });
      // Each planner word's syllables, and its match among gruut's words by text.
      const syllables = new Map<number, number[]>();
      plan.aligned.forEach(({ unit }, index) => {
        if (unit.kind !== "syllable" || unit.word === undefined) return;
        syllables.set(unit.word, [...(syllables.get(unit.word) ?? []), index]);
      });
      const match = new Map<number, number>();
      let next = 0;
      for (const word of [...syllables.keys()].sort((a, b) => a - b)) {
        const unit = plan.aligned[syllables.get(word)![0]!]!.unit;
        const text = clip.text.slice(unit.start, unit.end).toLowerCase();
        for (let k = next; k < Math.min(gruut.length, next + 4); k += 1) {
          if (gruut[k]!.text === text) {
            match.set(word, k);
            next = k + 1;
            break;
          }
        }
      }
      for (const beat of plan.gestures.beats) {
        const k = match.get(beat.wordIndex);
        if (k === undefined) continue;
        beats += 1;
        const own = syllables.get(beat.wordIndex)!;
        if (
          gruut[k]!.count === own.length &&
          gruut[k]!.stressed === own.indexOf(beat.unitIndex)
        ) {
          onStress += 1;
        }
      }
    }
    expect(beats).toBeGreaterThan(100);
    expect(onStress / beats).toBeGreaterThanOrEqual(0.75);
  });
});
