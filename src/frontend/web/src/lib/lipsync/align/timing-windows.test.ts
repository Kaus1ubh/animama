import { beforeAll, describe, expect, it } from "vitest";
import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import { loadEnglishDictionary } from "@/lib/lipsync/text/english-dictionary";
import { textToUnits } from "@/lib/lipsync/text/text-units";
import { matchTimingToText, unitTimingWindows } from "./timing-windows";

/** Characters timed one after another, `step` seconds each, with optional overrides. */
function timeline(
  text: string,
  step = 0.1,
  times: Record<number, [number, number]> = {},
): TimedChar[] {
  return [...text].map((char, index) => {
    const [startSec, endSec] = times[index] ?? [
      index * step,
      (index + 1) * step,
    ];
    return { char, startSec, endSec };
  });
}

beforeAll(async () => {
  await loadEnglishDictionary();
});

describe("matchTimingToText", () => {
  it("matches characters despite added spaces and a split decimal", () => {
    // The dialogue socket sends "$5. 99" and a trailing space.
    const text = "It's $5.99, ok.";
    const timed = timeline("It's $5. 99, ok. ");
    const times = matchTimingToText(text, timed);
    expect(
      times.every((time, index) => text[index] === " " || time !== null),
    ).toBe(true);
    expect(times[text.indexOf("9")]!.char).toBe("9");
    expect(times[text.indexOf("9")]!.startSec).toBeCloseTo(0.9);
  });

  it("recovers after a character the provider changed", () => {
    const times = matchTimingToText("a-b c", timeline("a b c"));
    expect(times[0]!.char).toBe("a");
    expect(times[2]!.char).toBe("b");
    expect(times[4]!.char).toBe("c");
  });

  it("leaves characters that have not arrived untimed", () => {
    const times = matchTimingToText("hello there", timeline("hello th"));
    expect(times[7]).not.toBeNull();
    expect(times[8]).toBeNull();
  });
});

describe("unitTimingWindows", () => {
  const options = { hanLanguage: "zh" as const };

  it("divides a word's window among its syllables by weight", () => {
    const text = "banana";
    const units = textToUnits(text, options);
    const { windows } = unitTimingWindows(text, units, timeline(text));
    const timed = windows.filter((w) => w !== null);
    expect(timed.length).toBe(units.length);
    expect(timed[0]!.startSec).toBeCloseTo(0);
    expect(timed.at(-1)!.endSec).toBeCloseTo(0.6);
    expect(timed[0]!.toleranceSec).toBeCloseTo(0.06);
  });

  it("keeps a word's end open until its last character arrives", () => {
    const text = "hello there";
    const units = textToUnits(text, options);
    const { units: out, windows } = unitTimingWindows(
      text,
      units,
      timeline("hello th"),
      {
        horizonSec: 0.8,
      },
    );
    const there = out.findIndex(
      (unit) => unit.start === 6 && unit.kind !== "pause",
    );
    expect(windows[there]!.startSec).toBeCloseTo(0.6);
    expect(windows[there]!.endSec).toBe(Infinity);
  });

  it("starts untimed units after the horizon, with an open pause before them", () => {
    const text = "Hmm, let me see.";
    const units = textToUnits(text, options);
    // Only "Hmm," has been timed; 0.8 s of audio has arrived.
    const { units: out, windows } = unitTimingWindows(
      text,
      units,
      timeline("Hmm,"),
      {
        horizonSec: 0.8,
      },
    );
    const comma = out.findIndex((unit) => unit.kind === "pause");
    expect(windows[comma]!.endSec).toBe(Infinity);
    const let_ = out.findIndex((unit) => unit.start === text.indexOf("let"));
    expect(windows[let_]!.startSec).toBeCloseTo(0.8);
    expect(windows[let_]!.endSec).toBe(Infinity);

    // Without punctuation, a pause is added before the first untimed word.
    const plain = "one two";
    const { units: added, windows: addedWindows } = unitTimingWindows(
      plain,
      textToUnits(plain, options),
      timeline("one"),
      { horizonSec: 0.6 },
    );
    const gap = added.findIndex((unit) => unit.kind === "pause");
    expect(addedWindows[gap]!.startSec).toBeCloseTo(0.3);
    expect(addedWindows[gap]!.endSec).toBe(Infinity);
  });

  it("gives punctuation a loose window and tags a wide tolerance", () => {
    const text = "[laughs] Yes, ok.";
    const units = textToUnits(text, options);
    const { units: out, windows } = unitTimingWindows(
      text,
      units,
      timeline(text),
    );
    const tag = out.findIndex((unit) => unit.kind === "tag");
    expect(windows[tag]).toMatchObject({ startSec: 0, toleranceSec: 0.4 });
    const comma = out.findIndex(
      (unit) => unit.kind === "pause" && unit.start === text.indexOf(","),
    );
    // From the start of "Yes" into "ok", the next sound.
    expect(windows[comma]!.startSec).toBeCloseTo(0.9);
    expect(windows[comma]!.endSec).toBeGreaterThan(1.4);
  });

  it("adds an optional pause where the provider leaves a gap", () => {
    const text = "one two";
    const units = textToUnits(text, options);
    const { units: out, windows } = unitTimingWindows(
      text,
      units,
      timeline(text, 0.1, { 4: [0.6, 0.7], 5: [0.7, 0.8], 6: [0.8, 0.9] }),
    );
    expect(out.length).toBe(units.length + 1);
    const gap = out.findIndex((unit) => !units.includes(unit));
    expect(out[gap]!.kind).toBe("pause");
    expect(windows[gap]!.startSec).toBeCloseTo(0.3);
    expect(windows[gap]!.endSec).toBeCloseTo(0.6);
  });
});
