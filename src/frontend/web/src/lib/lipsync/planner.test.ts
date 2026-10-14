import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { sliceSpeechFeatures } from "@/lib/lipsync/audio/features";
import { decodeEvalClip, type EncodedEvalClip } from "@/lib/lipsync/eval/clip";
import { joinEvalClips } from "@/lib/lipsync/eval/join";
import { loadChineseReadings } from "@/lib/lipsync/text/converters";
import { loadEnglishDictionary } from "@/lib/lipsync/text/english-dictionary";
import { phraseChunks, plannedGestureTimeline } from "./planned-segment";
import { createLipSyncPlanner } from "./planner";
import type { LipSyncUnit } from "./text/units";

const fixture = (id: string) =>
  decodeEvalClip(
    JSON.parse(
      readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          `../../../tests/lipsync/fixtures/${id}.json`,
        ),
        "utf8",
      ),
    ) as EncodedEvalClip,
  );

beforeAll(async () => {
  await Promise.all([loadEnglishDictionary(), loadChineseReadings()]);
});

describe("createLipSyncPlanner", () => {
  it("plans a whole clip into a track, aligned units and gesture timing", () => {
    const clip = fixture("t-en-laugh");
    const planner = createLipSyncPlanner({ text: clip.text });
    const plan = planner.plan({
      features: clip.features,
      timing: clip.timing,
      complete: true,
    });
    expect(plan.track.frames.length / 5).toBeGreaterThanOrEqual(
      Math.ceil(clip.durationSec * 60),
    );
    expect(plan.track.events.some((event) => event.label === "[laughs]")).toBe(
      true,
    );
    expect(plan.gestures.beats.length).toBeGreaterThan(2);
    expect(plan.gestures.words.length).toBeGreaterThan(5);
    // Every text unit is placed once, in order.
    const placed = plan.aligned
      .map((a) => a.unit)
      .filter((unit) => planner.units.includes(unit));
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("reads a kanji-only part as Japanese when the rest of the reply has kana", () => {
    const hanKinds = (units: readonly LipSyncUnit[]) =>
      units.filter((unit) => unit.kind !== "pause").map((unit) => unit.kind);
    const reply = "了解！すぐ行きます。";
    const inReply = createLipSyncPlanner({
      text: "",
      languageContext: () => reply,
    });
    inReply.setText("了解！");
    // Japanese kanji without readings are unknown vowels; Chinese has pinyin.
    expect(new Set(hanKinds(inReply.units))).toEqual(new Set(["unknown"]));
    expect(
      hanKinds(createLipSyncPlanner({ text: "了解！" }).units),
    ).not.toContain("unknown");
  });

  it("follows the audio alone when the text has nothing to say", () => {
    const clip = fixture("s-en");
    const plan = createLipSyncPlanner({ text: "!!! ***" }).plan({
      features: clip.features,
      timing: null,
      complete: true,
    });
    expect(plan.fallback).toBe("no_text");
    expect(Math.max(...plan.track.frames)).toBeGreaterThan(0.3);
  });

  it("places a tag that is a part on its own", () => {
    // A laugh in a part of its own: "That's great! <laugh>" can end that way.
    const clip = fixture("g-en-laugh");
    const plan = createLipSyncPlanner({ text: "<laugh>" }).plan({
      features: clip.features,
      timing: null,
      complete: true,
    });
    expect(plan.fallback).toBeNull();
    expect(plan.track.events.some((event) => event.kind === "laugh")).toBe(
      true,
    );
  });

  it("plans a reply spoken in parts against each part's audio", () => {
    // Gemini speaks each batch of sentences separately. A sigh that looks like
    // words cannot use up the next part's words.
    const reply = joinEvalClips(
      ["g-en-sigh", "g-en-laugh", "s-en"].map(fixture),
      { parts: true },
    );
    const parts = reply.parts!;
    const planner = createLipSyncPlanner({ text: "" });
    const rate = reply.features.rate;
    let started = 0;
    let plan: ReturnType<typeof planner.plan> | null = null;
    const total = reply.features.loudnessDb.length;
    for (let frames = 25; ; frames = Math.min(total, frames + 25)) {
      for (; started < parts.length; started += 1) {
        const start = Math.round(parts[started]!.startSec * rate);
        if (start > frames) break;
        planner.startPart(
          parts[started]!.text,
          sliceSpeechFeatures(reply.features, start),
        );
      }
      plan = planner.plan({
        features: sliceSpeechFeatures(reply.features, frames),
        timing: null,
        complete: frames === total,
      });
      if (frames === total) break;
    }
    expect(plan!.fallback).toBeNull();
    // Each part's syllables, in order, sound within that part's audio.
    const syllables = (units: readonly LipSyncUnit[]) =>
      units.filter((unit) => unit.kind === "syllable");
    const spoken = plan!.aligned.filter(({ unit }) => unit.kind === "syllable");
    let next = 0;
    parts.forEach((part, index) => {
      const count = syllables(
        createLipSyncPlanner({ text: part.text }).units,
      ).length;
      const to = parts[index + 1]?.startSec ?? reply.durationSec;
      for (const placed of spoken.slice(next, next + count)) {
        expect(placed.startSec).toBeGreaterThanOrEqual(part.startSec - 0.01);
        expect(placed.endSec).toBeLessThanOrEqual(to + 0.01);
      }
      next += count;
    });
    expect(next).toBe(spoken.length);
    expect(next).toBeGreaterThan(20);
  });

  it.each(["g-en-long", "s-ja", "s-ko", "s-zh"])(
    "gives talking hands phrases they can schedule (%s)",
    (id) => {
      // The hands layer finds each chunk's words and beats by word index.
      const clip = fixture(id);
      const plan = createLipSyncPlanner({ text: clip.text }).plan({
        features: clip.features,
        timing: clip.timing,
        complete: true,
      });
      const timeline = plannedGestureTimeline(plan.gestures, clip.durationSec);
      const chunks = phraseChunks("run-1", timeline.phrases!);
      expect(chunks.length).toBeGreaterThan(0);
      const inChunk = (chunk: (typeof chunks)[number], wordIndex: number) =>
        wordIndex >= chunk.wordStartIndex && wordIndex < chunk.wordEndIndex;
      for (const chunk of chunks) {
        expect(chunk.wordCount).toBeGreaterThan(0);
        expect(
          timeline.wordTimings.some((word) => inChunk(chunk, word.wordIndex)),
        ).toBe(true);
      }
      // Every beat belongs to a phrase.
      expect(timeline.beats.length).toBeGreaterThan(0);
      for (const beat of timeline.beats) {
        expect(chunks.some((chunk) => inChunk(chunk, beat.wordIndex))).toBe(
          true,
        );
      }
    },
  );

  it("gives talking hands provisional beats on words not heard yet", () => {
    const clip = fixture("g-en-long");
    const planner = createLipSyncPlanner({ text: clip.text });
    const heardSec = 2;
    const partial = planner.plan({
      features: sliceSpeechFeatures(clip.features, heardSec * 100),
      timing: null,
      complete: false,
    });
    // Words after the audio so far have estimated times, and beats.
    const ahead = partial.gestures.words.filter(
      (word) => word.startSec >= heardSec,
    );
    expect(ahead.length).toBeGreaterThan(5);
    const lastWord = Math.max(
      ...partial.gestures.words.map((w) => w.wordIndex),
    );
    expect(
      partial.gestures.beats.filter((beat) => beat.timeSec > heardSec).length,
    ).toBeGreaterThan(2);
    // Beats stay apart across the end of the audio.
    const times = partial.gestures.beats.map((beat) => beat.timeSec);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
    // Once the audio has all arrived, every word is placed from it.
    const whole = planner.plan({
      features: clip.features,
      timing: null,
      complete: true,
    });
    expect(Math.max(...whole.gestures.words.map((w) => w.wordIndex))).toBe(
      lastWord,
    );
    expect(
      whole.gestures.beats.every((b) => b.timeSec <= clip.durationSec),
    ).toBe(true);
  });

  it("marks phrases that end with an exclamation", () => {
    const clip = fixture("s-en");
    const plan = createLipSyncPlanner({
      text: "That is amazing! Tell me more, please.",
    }).plan({ features: clip.features, timing: null, complete: true });
    const chunks = phraseChunks("run-1", plan.gestures.phrases);
    expect(chunks[0]!.isExclamation).toBe(true);
    expect(chunks.slice(1).every((chunk) => !chunk.isExclamation)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("reports and falls back when the text cannot fit the audio", () => {
    // "Hi!" against thirteen seconds of speech.
    const clip = fixture("p-en-long");
    const plan = createLipSyncPlanner({ text: "Hi!" }).plan({
      features: clip.features,
      timing: null,
      complete: true,
    });
    expect(plan.fallback).toBe("no_alignment");
    expect(Math.max(...plan.track.frames)).toBeGreaterThan(0.3);
  });

  it("takes text that grows while the audio plays", () => {
    const clip = fixture("e-en-long");
    const full = createLipSyncPlanner({ text: clip.text });
    const growing = createLipSyncPlanner({ text: "" });
    const firstStop = clip.text.search(/[.!?] /) + 1;
    const step = 25;
    let fullPlan: ReturnType<typeof full.plan> | null = null;
    let growingPlan: ReturnType<typeof growing.plan> | null = null;
    for (let frames = step; ; frames += step) {
      const complete = frames >= clip.features.loudnessDb.length;
      // The first sentence is known from the start, the rest after 1.5 s.
      growing.setText(frames < 150 ? clip.text.slice(0, firstStop) : clip.text);
      const input = {
        features: sliceSpeechFeatures(clip.features, frames),
        timing: clip.timing,
        complete,
      };
      fullPlan = full.plan(input);
      growingPlan = growing.plan(input);
      if (complete) break;
    }
    const starts = (plan: NonNullable<typeof fullPlan>) =>
      plan.gestures.words.map((word) => word.startSec);
    expect(starts(growingPlan!).length).toBe(starts(fullPlan!).length);
    starts(growingPlan!).forEach((start, index) =>
      expect(Math.abs(start - starts(fullPlan!)[index]!)).toBeLessThan(0.3),
    );
  });

  it("keeps the units it has placed as more audio arrives", () => {
    const clip = fixture("s-ja");
    const planner = createLipSyncPlanner({ text: clip.text });
    const step = 25;
    let previous: ReturnType<typeof planner.plan> | null = null;
    for (let frames = step; ; frames += step) {
      const complete = frames >= clip.features.loudnessDb.length;
      const plan = planner.plan({
        features: sliceSpeechFeatures(clip.features, frames),
        timing: null,
        complete,
      });
      // Units ending well before the newest audio (two seconds) stay put.
      if (previous) {
        const settled = previous.aligned.filter(
          (a) => a.endSec < (frames - step) / 100 - 2.5,
        );
        expect(plan.aligned.slice(0, settled.length)).toEqual(settled);
      }
      previous = plan;
      if (complete) break;
    }
  });
});
