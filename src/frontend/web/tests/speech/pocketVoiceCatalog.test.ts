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
  it("lists the core manifest voices and the downloadable catalog assets", () => {
    const read = (file: string) =>
      JSON.parse(readFileSync(path.join(repositoryRoot, file), "utf8"));
    const manifest = read("models/browser-speech/manifest.json") as {
      files: { path: string; target: string }[];
    };
    const catalog = read(
      "src/backend/animama/resources/model-assets.v1.json",
    ) as { assets: { id: string; size: number }[] };
    const coreVoices = manifest.files
      .filter((file) => file.target.startsWith("models/pocket-tts/voices/"))
      .map((file) => file.path.replace(/\.safetensors$/, ""))
      .sort();
    expect(
      POCKET_VOICES.filter((voice) => voice.delivery === "core")
        .map((voice) => voice.id)
        .sort(),
    ).toEqual(coreVoices);
    for (const voice of POCKET_VOICES) {
      if (voice.delivery === "core") {
        expect(voice.assetId).toBeNull();
        continue;
      }
      const asset = catalog.assets.find((item) => item.id === voice.assetId);
      expect(asset?.size).toBe(voice.sizeBytes);
    }
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

  it("keeps only voices the worker reported", () => {
    const groups = groupPocketVoices(["noah", "azelma", "legacy_voice"]);
    expect(
      groups.map((group) => [
        group.label,
        group.voices.map((voice) => voice.id),
      ]),
    ).toEqual([
      ["Female voices", ["azelma"]],
      ["Male voices", ["noah"]],
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
