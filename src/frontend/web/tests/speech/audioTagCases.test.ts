import { describe, expect, it } from "vitest";
import audioTagCases from "../../../../../tests/fixtures/audio-tag-cases.json";
import {
  AUDIO_TAG_ACCENT_PREFIX,
  AUDIO_TAG_WORD_CLASSES,
  NEUTRAL_AUDIO_TAGS,
  SPEECH_SOUND_CAP,
  classifyAudioTag,
  createProviderSpeechText,
  endsInsideAudioTag,
  findAudioTags,
  hideSpeechTags,
  stripAudioTags,
  type AudioTagClass,
} from "@animama/product-ui/audio-tags";

/** The backend runs the same file (tests/test_audio_tags.py), so both sides agree. */
describe("shared audio tag cases", () => {
  it("uses the shared vocabulary", () => {
    const { vocabulary } = audioTagCases;
    expect(SPEECH_SOUND_CAP).toBe(vocabulary.soundCap);
    expect(AUDIO_TAG_ACCENT_PREFIX).toBe(vocabulary.accentPrefix);
    expect(NEUTRAL_AUDIO_TAGS).toEqual(vocabulary.neutral);
    expect(
      Object.fromEntries(
        Object.entries(AUDIO_TAG_WORD_CLASSES).map(([name, words]) => [
          name,
          [...words].sort(),
        ]),
      ),
    ).toEqual(vocabulary.wordClasses);
  });

  it.each(audioTagCases.classes)(
    "classifies $direction as $class",
    ({ direction, class: tagClass }) => {
      expect(classifyAudioTag(direction)).toBe(tagClass as AudioTagClass);
    },
  );

  it.each(audioTagCases.tagLabels)(
    "finds the tags in $text",
    ({ text, tags }) => {
      expect(findAudioTags(text).map((tag) => tag.label)).toEqual(tags);
    },
  );

  it.each(audioTagCases.cases)(
    "$id",
    ({ chunks, gemini, elevenlabs, stripped }) => {
      const forGemini = createProviderSpeechText("gemini");
      const forElevenLabs = createProviderSpeechText("elevenlabs");
      expect(chunks.map((chunk) => forGemini(chunk))).toEqual(gemini);
      expect(chunks.map((chunk) => forElevenLabs(chunk))).toEqual(elevenlabs);
      expect(chunks.map((chunk) => stripAudioTags(chunk))).toEqual(stripped);
    },
  );
});

describe("tags still being written", () => {
  it.each(audioTagCases.openTags)(
    "$text ends inside a tag: $inside",
    ({ text, inside }) => {
      expect(endsInsideAudioTag(text)).toBe(inside);
    },
  );
});

describe("every neutral alias", () => {
  const rows = audioTagCases.vocabulary.neutral.flatMap((neutral) =>
    neutral.aliases.flatMap((alias) =>
      [`[${alias}]`, `<${alias}>`].map((written) => ({ neutral, written })),
    ),
  );

  it.each(rows)("maps $written in both syntaxes", ({ neutral, written }) => {
    expect(createProviderSpeechText("gemini")(`${written} Hi.`)).toBe(
      `${neutral.gemini} Hi.`,
    );
    expect(createProviderSpeechText("elevenlabs")(`${written} Hi.`)).toBe(
      `${neutral.elevenlabs} Hi.`,
    );
  });
});

describe("hideSpeechTags", () => {
  it("leaves text without tags unchanged", () => {
    expect(hideSpeechTags("  Hello there.\n")).toBe("  Hello there.\n");
    expect(hideSpeechTags("Is x < 5?")).toBe("Is x < 5?");
  });

  it("keeps a streamed segment's edges so segments still join", () => {
    const segments = [
      "Oh my gosh, [laughs] that is so funny! ",
      "[sighs] Anyway.",
    ];
    expect(segments.map(hideSpeechTags).join("")).toBe(
      "Oh my gosh, that is so funny! Anyway.",
    );
  });

  it("hides a segment that is only tags", () => {
    expect(hideSpeechTags(" [laughs] ")).toBe("");
  });

  it("keeps Markdown links", () => {
    expect(
      hideSpeechTags("Read [the guide](https://example.com) [laughs]"),
    ).toBe("Read [the guide](https://example.com)");
  });
});
