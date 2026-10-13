import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeEvalClip, type EncodedEvalClip } from "./clip";
import { evaluate } from "./evaluate";
import { estimatedEvalSource } from "./estimated-source";
import { pocketSpeechText } from "@/lib/speech/pocket-speech-text";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/lipsync/fixtures",
);

function loadClip(id: string) {
  const encoded = JSON.parse(
    readFileSync(path.join(fixturesDir, `${id}.json`), "utf8"),
  ) as EncodedEvalClip;
  return decodeEvalClip(encoded);
}

describe("lip-sync evaluation fixtures", () => {
  it("cover every test line with features, references and metadata", () => {
    const testset = JSON.parse(
      readFileSync(path.join(fixturesDir, "../testset.json"), "utf8"),
    ) as { lines: Array<{ id: string }> };
    const files = readdirSync(fixturesDir).filter((file) =>
      file.endsWith(".json"),
    );
    expect(files.map((file) => file.replace(/\.json$/, "")).sort()).toEqual(
      testset.lines.map((line) => line.id).sort(),
    );

    const clip = loadClip("t-ja");
    expect(clip.durationSec).toBeGreaterThan(1);
    expect(clip.features.loudnessDb.length).toBe(
      Math.ceil(clip.durationSec * 100),
    );
    expect(clip.timing?.length).toBeGreaterThan(10);
    expect(clip.reference.vowels.length).toBeGreaterThan(10);
  });

  it("speak Pocket lines as Pocket receives them", () => {
    const testset = JSON.parse(
      readFileSync(path.join(fixturesDir, "../testset.json"), "utf8"),
    ) as { lines: Array<{ provider: string; text: string; written?: string }> };
    const written = testset.lines.filter((line) => line.written !== undefined);
    expect(written.length).toBeGreaterThan(0);
    for (const line of written) {
      expect(line.provider).toBe("pocket");
      expect(line.text).toBe(pocketSpeechText(line.written!));
    }
  });

  it("score today's estimated planner on a few clips", () => {
    const clips = ["s-en", "g-en-laugh", "e-ja"].map(loadClip);
    const rows = evaluate(clips, [estimatedEvalSource], ["whole"]);
    const main = rows.find((row) => row.set === "main" && !row.heldOut)!;
    // Today's plan leaves the mouth open in most silent gaps and shut for Japanese.
    expect(main.summary.openInSilenceEnglish).toBeGreaterThan(0.5);
    const eleven = rows.find((row) => row.set === "eleven-http")!;
    expect(eleven.summary.vowelMatchCjk).toBeLessThan(0.2);
    expect(eleven.summary.tagsPlaced).toBe(0);
  });
});
