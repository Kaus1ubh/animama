import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_POCKET_VOICE,
  POCKET_VOICES,
} from "../../src/lib/speech/pocket/voice-catalog";
import {
  groupPocketVoices,
  pocketVoiceLabel,
} from "../../src/lib/speech/pocket/voice-groups";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

describe("Pocket voice catalog", () => {
  it("lists exactly the voice states in the browser speech manifest", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(repositoryRoot, "models/browser-speech/manifest.json"),
        "utf8",
      ),
    ) as { files: { path: string; target: string }[] };
    const manifestVoices = manifest.files
      .filter((file) => file.target.startsWith("models/pocket-tts/voices/"))
      .map((file) => file.path.replace(/\.safetensors$/, ""))
      .sort();
    expect(POCKET_VOICES.map((voice) => voice.id).sort()).toEqual(
      manifestVoices,
    );
    expect(POCKET_VOICES.map((voice) => voice.id)).toContain(
      DEFAULT_POCKET_VOICE,
    );
  });
});

describe("groupPocketVoices", () => {
  it("groups available voices by gender with recommended voices first", () => {
    const groups = groupPocketVoices(POCKET_VOICES.map((voice) => voice.id));
    expect(groups.map((group) => group.label)).toEqual([
      "Female voices",
      "Male voices",
    ]);
    for (const group of groups) {
      const recommended = group.voices.map((voice) => voice.recommended);
      expect(recommended).toEqual([...recommended].sort().reverse());
      const genders = group.voices.map(
        (option) =>
          POCKET_VOICES.find((voice) => voice.id === option.id)?.gender,
      );
      expect(new Set(genders).size).toBe(1);
    }
    expect(groups.flatMap((group) => group.voices)).toHaveLength(
      POCKET_VOICES.length,
    );
  });

  it("keeps only voices the worker reported, and lists unknown ones last", () => {
    const groups = groupPocketVoices(["noah", "azelma", "legacy_voice"]);
    expect(
      groups.map((group) => [
        group.label,
        group.voices.map((voice) => voice.id),
      ]),
    ).toEqual([
      ["Female voices", ["azelma"]],
      ["Male voices", ["noah"]],
      ["Other voices", ["legacy_voice"]],
    ]);
  });

  it("omits empty groups", () => {
    expect(groupPocketVoices([])).toEqual([]);
  });
});

describe("pocketVoiceLabel", () => {
  it("names built-in, custom and unknown voices", () => {
    expect(pocketVoiceLabel("caro_davy")).toBe("Caro Davy");
    expect(pocketVoiceLabel("custom")).toBe("Custom (uploaded)");
    expect(pocketVoiceLabel("legacy_voice")).toBe("legacy_voice");
  });
});
