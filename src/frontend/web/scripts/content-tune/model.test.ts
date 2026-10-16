import assert from "node:assert/strict";
import test from "node:test";

import {
  TuneIndex,
  ladderNotes,
  peakExpressions,
  soundGroups,
  type TuneItem,
  type TuneSound,
} from "./model.ts";

const pop: TuneSound = {
  key: "bubble_pop_01",
  ref: "builtin:sound-effect:bubble_pop_01",
  name: "Bubble Pop",
  description: null,
  duration: 0.4,
  category: "Bubble",
  shipped: true,
  available: true,
};
const ding: TuneSound = {
  ...pop,
  key: "ding_02",
  ref: "builtin:sound-effect:ding_02",
  name: "Ding",
  category: "Misc",
  available: false,
};

function reaction(
  intensity: number,
  kinds: string[],
  expressions: Record<string, number[]> = { happy: [0.5] },
): TuneItem {
  return {
    kind: "reaction",
    stem: `joy-${intensity}`,
    contentId: `builtin:reaction:joy-${intensity}`,
    name: `Joy ${intensity}`,
    emotion: "joy",
    intensity,
    revision: "r",
    dependencies: [
      {
        ref: pop.ref,
        alias: "pop",
        content_type: "sound_effect",
      },
    ],
    clip: {
      id: "joy",
      duration: 3,
      expressions: Object.fromEntries(
        Object.entries(expressions).map(([name, values]) => [
          name,
          values.map((v) => ({ v, beat: "peak" })),
        ]),
      ),
      events: kinds.map((kind, index) => ({
        id: `e${index}`,
        time: index,
        kind,
        ...(kind === "sfx" ? { cueId: "pop" } : { effectId: `x${index}` }),
      })),
    },
  };
}

test("notes where a Reaction departs from the ladder", () => {
  assert.deepEqual(ladderNotes(reaction(1, [])), []);
  assert.deepEqual(ladderNotes(reaction(1, ["avatar_vfx"])), []);
  assert.equal(ladderNotes(reaction(1, ["particle_vfx"])).length, 1);
  assert.deepEqual(ladderNotes(reaction(2, [])), ["no Avatar Effect"]);
  assert.deepEqual(ladderNotes(reaction(4, ["avatar_vfx", "particle_vfx"])), [
    "no Scene Effect",
  ]);
  assert.deepEqual(
    ladderNotes(reaction(4, ["avatar_vfx", "particle_vfx", "scene_vfx"])),
    [],
  );
  assert.deepEqual(ladderNotes({ ...reaction(4, []), kind: "gesture" }), []);
});

test("reads peak expression weights, strongest first", () => {
  assert.deepEqual(
    peakExpressions(reaction(2, [], { happy: [0.3, 0.7], relaxed: [0.9] })),
    [
      ["relaxed", 0.9],
      ["happy", 0.7],
    ],
  );
});

test("resolves sound cues by event alias or by an effect's content ID", () => {
  const index = new TuneIndex({ effects: [], sounds: [pop, ding] });
  const item = reaction(2, ["sfx"]);
  assert.equal(index.soundUrl(item, "pop"), "/__tune/sound/bubble_pop_01");
  assert.equal(
    index.soundUrl(item, "builtin:sound-effect:bubble_pop_01"),
    "/__tune/sound/bubble_pop_01",
  );
  // A sound with no local audio, or an unknown cue, plays nothing.
  assert.equal(index.soundUrl(item, ding.ref), null);
  assert.equal(index.soundUrl(item, "missing"), null);
  assert.equal(index.targetName(item, item.clip.events![0]), "Bubble Pop");
});

test("groups sounds by category", () => {
  assert.deepEqual(
    soundGroups([ding, pop]).map(([category, sounds]) => [
      category,
      sounds.map((sound) => sound.key),
    ]),
    [
      ["Bubble", ["bubble_pop_01"]],
      ["Misc", ["ding_02"]],
    ],
  );
});
