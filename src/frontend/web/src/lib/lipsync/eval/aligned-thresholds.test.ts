/**
 * The D2 thresholds for the new planner, scored progressively at each
 * provider's delivery rate: Gemini and Pocket (the main set) at 2.9× real time,
 * ElevenLabs at 2.9× and as a live stream with a 0.3 s buffer.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { alignedEvalSource } from "./aligned-source";
import { decodeEvalClip, type EncodedEvalClip, type EvalClip } from "./clip";
import { evaluate, type EvaluationRow } from "./evaluate";
import { summarise } from "./report";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/lipsync/fixtures",
);

let rows: EvaluationRow[] = [];

beforeAll(async () => {
  await alignedEvalSource.prepare!();
  const clips: EvalClip[] = readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) =>
      decodeEvalClip(
        JSON.parse(
          readFileSync(path.join(fixturesDir, file), "utf8"),
        ) as EncodedEvalClip,
      ),
    );
  rows = evaluate(clips, [alignedEvalSource], ["faster", "live"]);
}, 120_000);

/** One summary over the rows that match, rescored together. */
function summary(mode: "faster" | "live", sets: string[], heldOut: boolean) {
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

const ELEVEN = ["eleven-http", "eleven-socket"];

describe("aligned planner thresholds (D2)", () => {
  it("default tier, Gemini and Pocket at 2.9×", () => {
    const main = summary("faster", ["main"], false);
    expect(main.openInSilenceEnglish).toBeLessThanOrEqual(0.1);
    expect(main.openInSilenceTags).toBeLessThanOrEqual(0.1);
    expect(main.vowelMatchCjk).toBeGreaterThanOrEqual(0.4);
  });

  it.each(["faster", "live"] as const)("ElevenLabs with timing, %s", (mode) => {
    const eleven = summary(mode, ELEVEN, false);
    expect(eleven.openInSilenceEnglish ?? 0).toBeLessThanOrEqual(0.1);
    expect(eleven.openInSilenceTags).toBeLessThanOrEqual(0.1);
    expect(eleven.vowelMatchCjk).toBeGreaterThanOrEqual(0.6);
    expect(eleven.tagsPlaced / eleven.tagsTotal).toBeGreaterThanOrEqual(0.75);
  });

  it.each([
    ["faster", ["main"]],
    ["faster", ELEVEN],
    ["live", ELEVEN],
  ] as const)("held-out clips stay within 10 points (%s, %j)", (mode, sets) => {
    const tuning = summary(mode, [...sets], false);
    const heldOut = summary(mode, [...sets], true);
    for (const key of [
      "vowelMatchCjk",
      "openInSilenceEnglish",
      "openInSilenceTags",
    ] as const) {
      const a = tuning[key];
      const b = heldOut[key];
      if (a === null || b === null) continue;
      expect(Math.abs(a - b), key).toBeLessThanOrEqual(0.1);
    }
  });
});
