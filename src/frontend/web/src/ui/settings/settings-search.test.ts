import { describe, expect, it } from "vitest";

import {
  availableSettingsSections,
  buildSettingsSearchOptions,
  matchesSettingsQuery,
  splitHighlightedText,
  tokenizeSettingsQuery,
} from "./settings-search";

const streamEntry = {
  section: "Voice",
  group: "Text-to-speech",
  label: "Stream chunked TTS",
  description: "Start speaking before the full response is ready.",
} as const;

describe("settings search", () => {
  it("treats a blank query as matching everything", () => {
    expect(tokenizeSettingsQuery("   ")).toEqual([]);
    expect(matchesSettingsQuery(streamEntry, [])).toBe(true);
  });

  it("matches every token case-insensitively in any order", () => {
    expect(
      matchesSettingsQuery(streamEntry, tokenizeSettingsQuery("tts STREAM")),
    ).toBe(true);
    expect(
      matchesSettingsQuery(
        streamEntry,
        tokenizeSettingsQuery("voice speaking"),
      ),
    ).toBe(true);
    expect(
      matchesSettingsQuery(streamEntry, tokenizeSettingsQuery("tts memory")),
    ).toBe(false);
  });

  it("searches keywords that are not shown in the UI", () => {
    const entry = {
      section: "Shortcuts",
      label: "Quick chat",
      keywords: ["hotkey", "keyboard"],
    } as const;
    expect(matchesSettingsQuery(entry, tokenizeSettingsQuery("hotkey"))).toBe(
      true,
    );
  });
});

describe("settings search dropdown options", () => {
  const sections = ["General", "Voice", "Memory"] as const;
  const entries = [
    { id: "volume", section: "General", label: "Volume" },
    { id: "stt", section: "Voice", label: "Speech-to-text provider" },
    { id: "tts", section: "Voice", label: "TTS provider" },
    { id: "mm", section: "Memory", label: "Memory Manager model" },
  ] as const;

  it("returns nothing for a blank query", () => {
    expect(buildSettingsSearchOptions(entries, sections, [])).toEqual([]);
  });

  it("groups matches under section headers across all sections", () => {
    const options = buildSettingsSearchOptions(
      entries,
      sections,
      tokenizeSettingsQuery("provider"),
    );
    expect(options.map((option) => option.key)).toEqual([
      "section:Voice",
      "entry:stt",
      "entry:tts",
    ]);
  });

  it("lists a section header when only the section name matches", () => {
    const options = buildSettingsSearchOptions(
      [],
      sections,
      tokenizeSettingsQuery("memor"),
    );
    expect(options.map((option) => option.key)).toEqual(["section:Memory"]);
  });
});

describe("splitHighlightedText", () => {
  it("marks each token occurrence case-insensitively", () => {
    expect(splitHighlightedText("Stream chunked TTS", ["tts", "str"])).toEqual([
      { text: "Str", match: true },
      { text: "eam chunked ", match: false },
      { text: "TTS", match: true },
    ]);
  });

  it("escapes regex characters in tokens", () => {
    expect(splitHighlightedText("a+b", ["+"])).toEqual([
      { text: "a", match: false },
      { text: "+", match: true },
      { text: "b", match: false },
    ]);
  });
});

describe("availableSettingsSections", () => {
  it("keeps navigation order and drops sections without entries", () => {
    expect(
      availableSettingsSections(
        ["General", "Appearance", "Voice", "About"] as const,
        [{ section: "Voice" }, { section: "General" }],
      ),
    ).toEqual(["General", "Voice"]);
  });
});

describe("Speech-to-Text copy", () => {
  it("finds the capitalized Speech-to-Text and Text-to-Speech settings", () => {
    const entries = [
      {
        id: "stt",
        section: "Voice",
        group: "Speech-to-Text",
        label: "Speech-to-Text provider",
      },
      {
        id: "tts",
        section: "Voice",
        group: "Text-to-Speech",
        label: "Enable TTS",
      },
    ] as const;
    const keys = buildSettingsSearchOptions(
      entries,
      ["Voice"] as const,
      tokenizeSettingsQuery("speech-to-text"),
    ).map((option) => option.key);
    expect(keys).toEqual(["section:Voice", "entry:stt"]);
  });
});
