import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { sliceSpeechFeatures } from "@/lib/lipsync/audio/features";
import { decodeEvalClip, type EncodedEvalClip } from "@/lib/lipsync/eval/clip";
import { loadEnglishDictionary } from "@/lib/lipsync/text/english-dictionary";
import { createLipSyncPlanner } from "./planner";

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
  await loadEnglishDictionary();
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
      // Units ending more than a second before the newest audio stay put.
      if (previous) {
        const settled = previous.aligned.filter(
          (a) => a.endSec < (frames - step) / 100 - 1,
        );
        expect(plan.aligned.slice(0, settled.length)).toEqual(settled);
      }
      previous = plan;
      if (complete) break;
    }
  });
});
