/**
 * The agreed thresholds (D2) for the new planner, scored progressively at each
 * provider's delivery rate: Gemini and Pocket (the main set) at 2.9× real time
 * and live, ElevenLabs at 2.9× and as a live stream with a 0.3 s buffer.
 *
 * Beyond D2, the tests guard against progressive plans drifting from the
 * speech: on every set, and on multi-sentence parts made by joining clips, the
 * mouth must open on reference vowels about as often as when the whole clip is
 * planned at once.
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
import { scoreClip } from "./metrics";
import { summarise } from "./report";

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
  )("%s, %s: vowels open about as often as whole", (mode, set) => {
    const whole = summary("whole", [set], false).vowelOpen!;
    expect(summary(mode, [set], false).vowelOpen!).toBeGreaterThanOrEqual(
      whole - DRIFT_ALLOWANCE,
    );
  });

  /** Clips joined into one part with 0.3 s of silence between, without timing. */
  function join(ids: string[]): EvalClip {
    const parts = ids.map((id) => clips.find((clip) => clip.id === id)!);
    const rate = parts[0]!.features.rate;
    const gap = Math.round(0.3 * rate);
    const total =
      parts.reduce((sum, clip) => sum + clip.features.loudnessDb.length, 0) +
      gap * (parts.length - 1);
    const loudnessDb = new Float32Array(total).fill(-90);
    const voicing = new Float32Array(total);
    const pitchHz = new Float32Array(total);
    const words: Array<[number, number]> = [];
    const vowels: Array<[number, number, number]> = [];
    let at = 0;
    for (const clip of parts) {
      const offset = at / rate;
      loudnessDb.set(clip.features.loudnessDb, at);
      voicing.set(clip.features.voicing, at);
      pitchHz.set(clip.features.pitchHz, at);
      for (const [s, e] of clip.reference.words)
        words.push([s + offset, e + offset]);
      for (const [v, s, e] of clip.reference.vowels) {
        vowels.push([v, s + offset, e + offset]);
      }
      at += clip.features.loudnessDb.length + gap;
    }
    return {
      ...parts[0]!,
      id: ids.join("+"),
      text: parts.map((clip) => clip.text).join(" "),
      durationSec: total / rate,
      features: { rate, loudnessDb, voicing, pitchHz },
      timing: null,
      reference: { words, vowels },
      estimated: null,
      intervalTags: 0,
    };
  }

  it.each([
    ["Gemini English", ["s-en", "g-en-long", "s-en-sad"]],
    ["Pocket English", ["p-en", "p-en-long", "h-p-en"]],
    ["Gemini Japanese", ["s-ja", "s-ja-excited", "h-g-ja", "g-ja-laugh"]],
    ["ElevenLabs English without timing", ["e-en", "e-en-long"]],
  ])("a multi-sentence part: %s", (_name, ids) => {
    const part = join(ids);
    const whole = scoreClip(
      runPlanSource(alignedEvalSource, part, ARRIVAL_MODES.whole).track,
      part,
    ).vowelOpen!;
    for (const mode of ["faster", "live"] as const) {
      const score = scoreClip(
        runPlanSource(alignedEvalSource, part, ARRIVAL_MODES[mode]).track,
        part,
      );
      expect(score.vowelOpen!, mode).toBeGreaterThanOrEqual(
        whole - DRIFT_ALLOWANCE,
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
