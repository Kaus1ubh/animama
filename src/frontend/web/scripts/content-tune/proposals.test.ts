import assert from "node:assert/strict";
import test from "node:test";

import { mergeProposals, proposalId } from "./proposals.ts";
import type { TuneEffect, TuneItem, TuneSound } from "./model.ts";

const POP = "builtin:sound-effect:bubble_pop_01";
const pop: TuneSound = {
  key: "bubble_pop_01",
  ref: POP,
  name: "Bubble Pop 01",
  description: null,
  duration: 0.4,
  category: "Bubble",
  shipped: true,
  available: true,
};
const gesture: TuneItem = {
  kind: "gesture",
  stem: "double-peace-pop",
  contentId: "builtin:gesture:double-peace-pop",
  name: "Double Peace Pop",
  emotion: null,
  intensity: null,
  revision: "rev-1",
  dependencies: [],
  clip: { id: "double-peace-pop", duration: 2.48, events: [] },
};
const effect: TuneEffect = {
  kind: "avatar",
  contentType: "avatar_effect",
  contentId: "builtin:avatar-effect:sweat_drop",
  stem: "sweat_drop",
  name: "Sweat Drop",
  sounds: { "on-apply": "builtin:sound-effect:funny_sweat_02" },
  soundAlias: "on-apply",
  revision: "eff-1",
};
const proposals = {
  items: {
    [gesture.contentId]: {
      note: "A pop on the peace pop.",
      add: [{ time: 0.54, sound: POP, volume: 0.8 }],
    },
  },
  effects: { [effect.contentId]: { note: "Brighter.", sound: POP } },
};
const base = {
  items: [gesture],
  effects: [effect],
  sounds: [pop],
  applied: {},
  effectSounds: {},
  seen: [],
};

test("applies proposals once as drafts, with their notes", () => {
  const merged = mergeProposals(proposals, base);
  const draft = merged.applied[gesture.contentId].draft;
  assert.deepEqual(draft.events, [
    {
      id: "bubble_pop_01",
      time: 0.54,
      kind: "sfx",
      cueId: "bubble_pop_01",
      volume: 0.8,
    },
  ]);
  assert.equal(draft.dependencies[0].ref, POP);
  assert.equal(merged.applied[gesture.contentId].revision, "rev-1");
  assert.deepEqual(merged.effectSounds[effect.contentId], {
    revision: "eff-1",
    sound: POP,
  });
  assert.equal(merged.notes[gesture.contentId], "A pop on the peace pop.");
  assert.equal(merged.seen.length, 2);
  assert.deepEqual(merged.problems, []);

  // A discarded proposal stays discarded: seen proposals don't merge again.
  const again = mergeProposals(proposals, { ...base, seen: merged.seen });
  assert.deepEqual(again.applied, {});
  assert.deepEqual(again.effectSounds, {});
  assert.equal(again.notes[gesture.contentId], "A pop on the peace pop.");
});

test("leaves the owner's applied edits alone and reports bad proposals", () => {
  const owned = {
    [gesture.contentId]: {
      kind: "gesture" as const,
      stem: gesture.stem,
      revision: "rev-1",
      draft: { events: [], expressions: {}, dependencies: [] },
    },
  };
  const merged = mergeProposals(
    {
      items: {
        ...proposals.items,
        "builtin:gesture:gone": { note: "", add: [] },
        [gesture.contentId.replace("double", "triple")]: { note: "", add: [] },
      },
    },
    { ...base, applied: owned },
  );
  assert.equal(merged.applied[gesture.contentId], owned[gesture.contentId]);
  assert.equal(merged.problems.length, 2);
  assert.ok(
    !merged.seen.includes(
      proposalId(gesture.contentId, proposals.items[gesture.contentId].add),
    ),
  );
  assert.deepEqual(
    mergeProposals({ error: "Proposals not loaded (bad JSON)." }, base)
      .problems,
    ["Proposals not loaded (bad JSON)."],
  );
});

test("reports malformed proposals and merges a changed one again", () => {
  const malformed = mergeProposals(
    {
      items: {
        [gesture.contentId]: { note: "n" },
        "builtin:gesture:b": { note: "n", add: [{ sound: POP }] },
      },
      effects: { [effect.contentId]: { note: { text: "x" }, sound: POP } },
    } as never,
    base,
  );
  assert.deepEqual(malformed.problems, [
    `${gesture.contentId}: malformed proposal.`,
    "builtin:gesture:b: malformed proposal.",
    `${effect.contentId}: malformed proposal.`,
  ]);
  assert.deepEqual(malformed.applied, {});

  const first = mergeProposals(proposals, base);
  // Rewording a note doesn't make it a new proposal; changing a sound does.
  const reworded = structuredClone(proposals);
  reworded.items[gesture.contentId].note = "Reworded.";
  assert.deepEqual(
    mergeProposals(reworded, { ...base, seen: first.seen }).applied,
    {},
  );
  const moved = structuredClone(proposals);
  moved.items[gesture.contentId].add[0].time = 0.9;
  assert.ok(
    mergeProposals(moved, { ...base, seen: first.seen }).applied[
      gesture.contentId
    ],
  );
});
