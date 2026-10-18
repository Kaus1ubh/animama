import assert from "node:assert/strict";
import test from "node:test";

import {
  addEvent,
  draftOf,
  isDirty,
  removeEvent,
  removeExpression,
  replaceTarget,
  saveRequest,
  setExpressionPeak,
  uniqueAlias,
  updateEvent,
  type TuneTarget,
} from "./draft.ts";
import type { TuneEffect, TuneItem, TuneSound } from "./model.ts";

const star: TuneEffect = {
  kind: "avatar",
  contentType: "avatar_effect",
  contentId: "builtin:avatar-effect:star3",
  stem: "star3",
  name: "Star3",
};
const hearts: TuneEffect = {
  kind: "particle",
  contentType: "particle_effect",
  contentId: "builtin:particle-effect:hearts",
  stem: "hearts",
  name: "Hearts",
};
const focus: TuneEffect = {
  kind: "scene",
  contentType: "scene_effect",
  contentId: "builtin:scene-effect:focus:dark",
  stem: "dark",
  name: "Dark",
  sceneKind: "focus_lines",
};
const pop: TuneSound = {
  key: "bubble_pop_01",
  ref: "builtin:sound-effect:bubble_pop_01",
  name: "Bubble Pop 01",
  description: null,
  duration: 0.4,
  category: "Bubble",
  shipped: true,
  available: true,
};
const effect = (value: TuneEffect): TuneTarget => ({
  type: "effect",
  effect: value,
});
const sound = (value: TuneSound): TuneTarget => ({
  type: "sound",
  sound: value,
});

function reaction(): TuneItem {
  return {
    kind: "reaction",
    stem: "joy-3",
    contentId: "builtin:reaction:joy-3",
    name: "Joy Reaction 3",
    emotion: "joy",
    intensity: 3,
    revision: "rev-1",
    dependencies: [
      {
        ref: star.contentId,
        alias: "star3",
        content_type: "avatar_effect",
        config: {},
      },
    ],
    clip: {
      id: "joy-3",
      duration: 3,
      expressions: {
        happy: [
          { v: 0.8, beat: "peak" },
          { v: 0.4, beat: "rest" },
        ],
      },
      events: [
        {
          id: "star",
          time: 0.1,
          kind: "avatar_vfx",
          effectId: "star3",
          playAccompanyingSound: false,
        },
      ],
    },
  };
}

test("adds effects and sounds with fresh aliases and event ids", () => {
  const item = reaction();
  let draft = draftOf(item);
  draft = addEvent(draft, effect(hearts), 0.123);
  draft = addEvent(draft, effect(focus), 0);
  draft = addEvent(draft, sound(pop), 0.5);
  // The same content again reuses its alias but gets a new event id.
  draft = addEvent(draft, effect(star), 1);

  assert.deepEqual(
    draft.events.map(({ id, kind, time }) => [id, kind, time]),
    [
      ["star", "avatar_vfx", 0.1],
      ["hearts", "particle_vfx", 0.12],
      ["dark", "scene_vfx", 0],
      ["bubble_pop_01", "sfx", 0.5],
      ["star3", "avatar_vfx", 1],
    ],
  );
  assert.equal(draft.events[1].duration, 2);
  assert.equal(draft.events[2].sceneKind, "focus_lines");
  assert.equal(draft.events[2].presetId, "dark");
  assert.equal(draft.events[3].cueId, "bubble_pop_01");
  assert.deepEqual(
    draft.dependencies.map(({ alias, content_type }) => [alias, content_type]),
    [
      ["star3", "avatar_effect"],
      ["hearts", "particle_effect"],
      ["dark", "scene_effect"],
      ["bubble_pop_01", "sound_effect"],
    ],
  );
  assert.equal(isDirty(item, draft), true);
  // Loading never mutates the item.
  assert.equal(isDirty(item, draftOf(item)), false);
});

test("replaces what an event plays, keeping its own settings", () => {
  let draft = draftOf(reaction());
  // Another Avatar Effect keeps the use's muted sound; its override drops.
  draft.events[0].override = { appearance: { opacity: 0.5 } };
  const swapped = replaceTarget(
    draft,
    "star",
    effect({
      ...star,
      contentId: "builtin:avatar-effect:sparkle",
      stem: "sparkle",
    }),
  );
  assert.deepEqual(swapped.events[0], {
    id: "star",
    time: 0.1,
    kind: "avatar_vfx",
    effectId: "sparkle",
    playAccompanyingSound: false,
  });
  // A sound in place of an effect turns it into a sound event.
  draft = replaceTarget(draft, "star", sound(pop));
  assert.deepEqual(draft.events[0], {
    id: "star",
    time: 0.1,
    kind: "sfx",
    cueId: "bubble_pop_01",
  });
});

test("edits and removes events", () => {
  let draft = draftOf(reaction());
  draft = updateEvent(draft, "star", {
    time: 0.456,
    playAccompanyingSound: true,
  });
  assert.deepEqual(draft.events[0], {
    id: "star",
    time: 0.46,
    kind: "avatar_vfx",
    effectId: "star3",
  });
  draft = updateEvent(draft, "star", { time: -1 });
  assert.equal(draft.events[0].time, 0);
  draft = removeEvent(draft, "star");
  assert.deepEqual(draft.events, []);
});

test("keeps an expression's shape through a peak of 0", () => {
  const curve = [
    { v: 0, beat: "start" },
    { v: 0.75, beat: "peak" },
    { v: 0, beat: "end" },
  ];
  let draft = draftOf(reaction());
  draft = { ...draft, expressions: { happy: curve } };
  draft = setExpressionPeak(draft, "happy", 0, "peak", curve);
  assert.deepEqual(
    draft.expressions.happy.map((frame) => frame.v),
    [0, 0, 0],
  );
  draft = setExpressionPeak(draft, "happy", 0.6, "peak", curve);
  assert.deepEqual(
    draft.expressions.happy.map((frame) => frame.v),
    [0, 0.6, 0],
  );
  // Repeated edits scale the loaded shape, so low keys don't drift.
  const shape = [
    { v: 0.1, beat: "a" },
    { v: 1, beat: "b" },
  ];
  draft = { ...draft, expressions: { blink: shape } };
  for (const value of [0.01, 0.5, 0.15, 1])
    draft = setExpressionPeak(draft, "blink", value, "b", shape);
  assert.deepEqual(draft.expressions.blink, shape);
});

test("sets a Reaction's peak expression weights", () => {
  let draft = draftOf(reaction());
  // Every key scales so the largest becomes the new peak.
  draft = setExpressionPeak(draft, "happy", 0.6, "peak");
  assert.deepEqual(draft.expressions.happy, [
    { v: 0.6, beat: "peak" },
    { v: 0.3, beat: "rest" },
  ]);
  draft = setExpressionPeak(draft, "relaxed", 1.4, "peak");
  assert.deepEqual(draft.expressions.relaxed, [{ v: 1, beat: "peak" }]);
  draft = removeExpression(draft, "happy");
  assert.deepEqual(Object.keys(draft.expressions), ["relaxed"]);
});

test("builds the save request and unique aliases", () => {
  const item = reaction();
  const draft = draftOf(item);
  assert.deepEqual(Object.keys(saveRequest(item, draft)), [
    "kind",
    "stem",
    "revision",
    "events",
    "expressions",
    "dependencies",
  ]);
  assert.equal(
    "expressions" in saveRequest({ ...item, kind: "gesture" }, draft),
    false,
  );
  assert.equal(
    uniqueAlias(
      [
        { ref: "a", alias: "pop", content_type: "sound_effect" },
        { ref: "b", alias: "pop-2", content_type: "sound_effect" },
      ],
      "pop",
    ),
    "pop-3",
  );
});
