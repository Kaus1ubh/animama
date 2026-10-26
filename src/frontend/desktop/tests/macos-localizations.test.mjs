import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { SUPPORTED_LOCALES } from "@animama/runtime-contracts/locale";
import { desktopRoot, electronDist } from "../scripts/runtime/common.mjs";

/**
 * Electron's own lproj folder for each translated UI Locale. Reusing them
 * adds no bundle localization, so macOS chooses the same one as before.
 */
const LPROJ = { ja: "ja", ko: "ko", "zh-Hans": "zh_CN", "zh-Hant": "zh_TW" };
const resources = path.join(desktopRoot, "build/locales");
const builderConfig = readFileSync(
  path.join(desktopRoot, "electron-builder.yml"),
  "utf8",
);

/** Parse the plain `"key" = "value";` lines the files use, ignoring comments. */
function parseStrings(text) {
  const entries = {};
  for (const line of text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const match = /^"([A-Za-z]+)" = "((?:[^"\\]|\\.)+)";$/u.exec(line);
    if (!match) throw new Error(`Unexpected strings line: ${line}`);
    entries[match[1]] = match[2];
  }
  return entries;
}

describe("localized macOS microphone prompt", () => {
  it("packages one InfoPlist.strings per translated locale into Contents/Resources", () => {
    // Inside the mac section, before the runtime stage resources.
    const mac = builderConfig.slice(
      builderConfig.indexOf("\nmac:\n"),
      builderConfig.indexOf("\nwin:\n"),
    );
    expect(mac).toMatch(
      /extraResources:\n(?:\s+#.*\n)*\s+- from: build\/locales\n\s+to: \.\n\s+filter:\n\s+- "\*\.lproj\/InfoPlist\.strings"\n/u,
    );
    expect(mac).toContain(
      "NSMicrophoneUsageDescription: Animama uses the microphone for dictation and voice mode.",
    );
    expect(readdirSync(resources).sort()).toEqual(
      Object.values(LPROJ)
        .map((name) => `${name}.lproj`)
        .sort(),
    );
    expect(Object.keys(LPROJ)).toEqual(
      SUPPORTED_LOCALES.filter((locale) => locale !== "en"),
    );
  });

  it.each(Object.entries(LPROJ))(
    "translates only the prompt for %s",
    (_locale, lproj) => {
      const file = path.join(resources, `${lproj}.lproj/InfoPlist.strings`);
      const entries = parseStrings(readFileSync(file, "utf8"));
      expect(Object.keys(entries)).toEqual(["NSMicrophoneUsageDescription"]);
      expect(entries.NSMicrophoneUsageDescription).toContain("Animama");
      expect(entries.NSMicrophoneUsageDescription).not.toContain("microphone");
      if (process.platform === "darwin") {
        const lint = spawnSync("/usr/bin/plutil", ["-lint", file], {
          encoding: "utf8",
        });
        expect(lint.status, lint.stdout + lint.stderr).toBe(0);
      }
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "merges into lproj folders the Electron app already ships",
    () => {
      const electron = path.join(
        electronDist(),
        "Electron.app/Contents/Resources",
      );
      for (const lproj of Object.values(LPROJ))
        expect(existsSync(path.join(electron, `${lproj}.lproj`)), lproj).toBe(
          true,
        );
    },
  );
});
