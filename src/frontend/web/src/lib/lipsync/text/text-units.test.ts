import { describe, expect, it } from "vitest";
import { chineseReadingsLoaded, loadChineseReadings } from "./converters";
import { lipSyncTagKind, splitTags, stripTags } from "./tags";
import {
  detectHanLanguage,
  textToUnits,
  type TextUnitOptions,
} from "./text-units";
import type { LipSyncUnit } from "./units";

const JA: TextUnitOptions = { hanLanguage: "ja" };
const ZH: TextUnitOptions = { hanLanguage: "zh" };

/** A compact picture of units: vowels, `?` unknown, `m` closure, `n` nasal, `|` pause, tags by kind. */
function shape(units: LipSyncUnit[]): string {
  return units
    .map((unit) => {
      if (unit.kind === "syllable") return unit.vowel!;
      if (unit.kind === "unknown") return "?";
      if (unit.kind === "closure") return "m";
      if (unit.kind === "nasal") return "n";
      if (unit.kind === "pause") return unit.pause === "stop" ? "|" : ",";
      return `<${unit.tag!.kind}>`;
    })
    .join("");
}

describe("tags", () => {
  it.each([
    ["laugh", "laugh"],
    ["laughs", "laugh"],
    ["chuckles softly", "laugh"],
    ["giggle", "laugh"],
    ["sigh", "sigh"],
    ["exhales", "sigh"],
    ["gasps", "gasp"],
    ["cough", "vocal"],
    ["crying", "vocal"],
    ["long pause", "pause"],
    ["short pause", "pause"],
    ["whispers", "whisper"],
    ["whispering, playful", "whisper"],
    ["excited", "delivery"],
    ["applause", "sound_effect"],
    ["laughs, whispering", "laugh"],
  ])("reads [%s] as %s", (content, kind) => {
    expect(lipSyncTagKind(content)).toBe(kind);
  });

  it("splits Gemini and ElevenLabs tags with their source ranges", () => {
    const text = "Oh <laugh> wow [sighs] ok";
    expect(splitTags(text)).toEqual([
      { type: "text", start: 0, end: 3 },
      {
        type: "tag",
        tag: {
          label: "<laugh>",
          start: 3,
          end: 10,
          kind: "laugh",
          kinds: ["laugh"],
        },
      },
      { type: "text", start: 10, end: 15 },
      {
        type: "tag",
        tag: {
          label: "[sighs]",
          start: 15,
          end: 22,
          kind: "sigh",
          kinds: ["sigh"],
        },
      },
      { type: "text", start: 22, end: 25 },
    ]);
    expect(stripTags(text)).toBe("Oh wow ok");
  });

  it("accepts sentence punctuation inside a tag", () => {
    expect(stripTags("Wow [laughs!] okay")).toBe("Wow okay");
  });

  it("leaves comparisons and other symbols in brackets alone", () => {
    const text = "If x < 5 and y > 3 then [see 2] it";
    expect(splitTags(text)).toEqual([
      { type: "text", start: 0, end: text.length },
    ]);
    expect(stripTags(text)).toBe(text);
  });

  it("leaves long bracketed text alone", () => {
    const long = `[${"a".repeat(80)}]`;
    expect(splitTags(long)).toEqual([
      { type: "text", start: 0, end: long.length },
    ]);
  });
});

describe("textToUnits", () => {
  it("reads kana morae, with long vowels, sokuon, n and glides", () => {
    // ちょっと → cho (O), small tsu (closure), to (O); ラーメン → ra (long A), me (E), n.
    expect(shape(textToUnits("ちょっと", JA))).toBe("OmO");
    const ramen = textToUnits("ラーメン", JA);
    expect(shape(ramen)).toBe("AmEn");
    expect(ramen[0]!.weight).toBe(2);
  });

  it("marks kanji as unknown vowels in Japanese and reads Chinese by pinyin", async () => {
    expect(shape(textToUnits("今日は", JA))).toBe("??A");
    await loadChineseReadings();
    expect(chineseReadingsLoaded()).toBe(true);
    // ni (I) hao (A); mama: closures before each A.
    expect(shape(textToUnits("你好", ZH))).toBe("IA");
    expect(shape(textToUnits("妈妈", ZH))).toBe("mAmA");
  });

  it("chooses the Han reading from the reply's kana", () => {
    expect(detectHanLanguage("今日はいい天気")).toBe("ja");
    expect(detectHanLanguage("今天天气很好")).toBe("zh");
  });

  it("reads Hangul syllables with closures and nasal codas", () => {
    // 감사 → ga (A) + ㅁ coda (closure), sa (A); 안녕 → a (A) + ㄴ (nasal), nyeo (O) + ㅇ (nasal).
    expect(shape(textToUnits("감사", JA))).toBe("AmA");
    expect(shape(textToUnits("안녕", JA))).toBe("AnOn");
  });

  it("reads digits beside CJK text in that language", () => {
    const units = textToUnits("3時に", JA);
    expect(shape(units)).toBe("??I");
    expect(shape(textToUnits("오늘 3시에", JA))).toBe("OI?IE");
  });

  it("spells out English numbers and keeps their source range", () => {
    const text = "It costs $5.";
    const units = textToUnits(text, JA);
    const spelled = units.filter((unit) => unit.start === 9 && unit.end === 11);
    // "five dollars" has at least three syllables, all mapped to "$5".
    expect(
      spelled.filter((unit) => unit.kind === "syllable").length,
    ).toBeGreaterThanOrEqual(3);
    expect(units[units.length - 1]!.kind).toBe("pause");
  });

  it("uses letter rules for accented Latin words", () => {
    // ¿Qué tal? → que (silent u, E), tal (A)
    expect(shape(textToUnits("¿Qué tal?", JA))).toBe("EA|");
  });

  it("turns tags into units and whispers into narrower words", () => {
    const units = textToUnits(
      "[whispers] hi there [laughs] no [excited] yes",
      JA,
    );
    expect(shape(units)).toContain("<laugh>");
    const words = units.filter((unit) => unit.kind === "syllable");
    // Whispering carries forward until another delivery direction.
    expect(words.slice(0, 3).every((unit) => unit.whisper)).toBe(true);
    expect(words[words.length - 1]!.whisper).toBeUndefined();
    const laugh = units.find((unit) => unit.kind === "tag")!;
    expect(laugh.tag).toEqual({ kind: "laugh", label: "[laughs]" });
    expect(laugh.weight).toBeCloseTo(0.9);
  });

  it("starts a whisper from a combined tag and ends it at the next delivery", () => {
    const units = textToUnits(
      "[laughs, whispering] hi [laughs, excited] there",
      JA,
    );
    const words = units.filter((unit) => unit.kind === "syllable");
    expect(units.filter((unit) => unit.kind === "tag")).toHaveLength(2);
    expect(words[0]!.whisper).toBe(true);
    expect(words[words.length - 1]!.whisper).toBeUndefined();
  });

  it("reads spaced and full-width digits inside CJK text in that language", () => {
    expect(shape(textToUnits("今日は 3 時です", JA))).toBe("??A??EU");
    expect(shape(textToUnits("３時", JA))).toBe("??");
  });

  it("keeps ASCII punctuation between CJK text as pauses", () => {
    expect(shape(textToUnits("안녕, 반가워", JA))).toContain(",");
    expect(shape(textToUnits("うーん...そうだね", JA))).toContain("|");
    expect(shape(textToUnits("今日は晴れ.明日は雨", JA))).toContain("|");
  });

  it("reads a kanji outside the Basic Multilingual Plane as one unit", () => {
    const units = textToUnits("𠮟る", JA);
    expect(shape(units)).toBe("?U");
    expect(units[0]).toMatchObject({ start: 0, end: 2 });
  });

  it("merges a run of punctuation into one pause", () => {
    const units = textToUnits("Hmm... okay!", JA);
    expect(shape(units).match(/\|/g)).toHaveLength(2);
    expect(units.filter((unit) => unit.kind === "pause")[0]!.end).toBe(6);
  });

  it("numbers words across scripts", () => {
    const units = textToUnits("Hello, 世界. 안녕 하세요", ZH);
    const words = new Set(
      units.map((unit) => unit.word).filter((w) => w !== undefined),
    );
    expect([...words]).toEqual([0, 1, 2, 3]);
  });

  it("keeps every unit's range inside the text", () => {
    const text = "<laugh> Wait, $5.99 at 3:30pm? 本当に！ 감사합니다 ¡Hola!";
    for (const unit of textToUnits(text, JA)) {
      expect(unit.start).toBeGreaterThanOrEqual(0);
      expect(unit.end).toBeLessThanOrEqual(text.length);
      expect(unit.end).toBeGreaterThanOrEqual(unit.start);
    }
  });
});
