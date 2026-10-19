import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  STARTER_LOADOUT,
  TuneSaveError,
  eventIssues,
  packChanges,
  planTuneSave,
  starterIdleKeys,
} from "./content-tune-save.mjs";
import { REPO_ROOT } from "./effect-render-sources.mjs";

const POP = "builtin:sound-effect:bubble_pop_01";
const DING = "builtin:sound-effect:ding_02";
const HEARTS = "builtin:particle-effect:hearts";
const STAR = "builtin:avatar-effect:star3";

const options = {
  includedTypes: new Map([
    [HEARTS, "particle_effect"],
    [STAR, "avatar_effect"],
  ]),
  packSounds: new Set([POP, DING]),
  shipped: new Set([POP]),
  idleKeys: new Set(),
};

function current(overrides = {}) {
  return {
    kind: "reaction",
    contentId: "builtin:reaction:joy-2",
    revision: "rev-1",
    meta: {
      content_type: "reaction",
      content_id: "builtin:reaction:joy-2",
      version: 1,
      dependencies: [
        {
          ref: STAR,
          alias: "star3",
          content_type: "avatar_effect",
          config: {},
        },
      ],
    },
    clip: {
      schema: "animaPoseClip/2.0",
      id: "joy-2",
      role: "reaction",
      duration: 3,
      playback: { lifetime: { kind: "whileInteractionPhase" } },
      expressions: { happy: [{ v: 0.5, beat: "peak" }] },
      events: [
        { id: "star", time: 0.1, kind: "avatar_vfx", effectId: "star3" },
      ],
    },
    ...overrides,
  };
}

test("replaces an effect, adds a sound and keeps the clip's identity", () => {
  const plan = planTuneSave(
    current(),
    {
      revision: "rev-1",
      events: [
        { id: "pop", time: 0.6, kind: "sfx", cueId: "pop", volume: 0.8 },
        { id: "hearts", time: 0.1, kind: "particle_vfx", effectId: "hearts" },
      ],
      expressions: { happy: [{ v: 0.8, beat: "peak" }] },
      dependencies: [
        { ref: STAR, alias: "star3", content_type: "avatar_effect" },
        { ref: HEARTS, alias: "hearts", content_type: "particle_effect" },
        { ref: DING, alias: "pop", content_type: "sound_effect" },
      ],
    },
    options,
  );

  // Events are kept in time order; the unused Avatar Effect edge drops.
  assert.deepEqual(
    plan.clip.events.map((event) => event.id),
    ["hearts", "pop"],
  );
  assert.equal(plan.clip.id, "joy-2");
  assert.equal(plan.clip.role, "reaction");
  assert.deepEqual(plan.clip.playback, current().clip.playback);
  assert.deepEqual(plan.clip.expressions, {
    happy: [{ v: 0.8, beat: "peak" }],
  });
  assert.equal(plan.meta.version, 1);
  assert.deepEqual(plan.meta.dependencies, [
    {
      ref: HEARTS,
      alias: "hearts",
      content_type: "particle_effect",
      config: {},
    },
    {
      ref: DING,
      alias: "pop",
      content_type: "sound_effect",
      config: {},
      optional: true,
    },
  ]);
  // The sound isn't in the tracked pack yet.
  assert.deepEqual(plan.pendingSounds, [DING]);
});

test("refuses a stale revision, an undeclared alias and an unknown sound", () => {
  assert.throws(
    () =>
      planTuneSave(
        current(),
        { revision: "old", events: [], dependencies: [] },
        options,
      ),
    TuneSaveError,
  );
  assert.throws(
    () =>
      planTuneSave(
        current(),
        {
          revision: "rev-1",
          events: [{ id: "x", time: 0, kind: "sfx", cueId: "nope" }],
          dependencies: [],
        },
        options,
      ),
    /which no dependency declares/,
  );
  assert.throws(
    () =>
      planTuneSave(
        current(),
        {
          revision: "rev-1",
          events: [{ id: "x", time: 0, kind: "sfx", cueId: "x" }],
          dependencies: [
            {
              ref: "builtin:sound-effect:unknown",
              alias: "x",
              content_type: "sound_effect",
            },
          ],
        },
        options,
      ),
    /not Included content/,
  );
});

test("stores an event list only where the clip stored one", () => {
  const plan = planTuneSave(
    current({ clip: { ...current().clip, events: [] } }),
    { revision: "rev-1", events: [], dependencies: [] },
    options,
  );
  assert.deepEqual(plan.clip.events, []);
  const { events: _events, ...withoutEvents } = current().clip;
  const bare = planTuneSave(
    current({ clip: withoutEvents }),
    { revision: "rev-1", events: [], dependencies: [] },
    options,
  );
  assert.equal("events" in bare.clip, false);
});

test("keeps a Gesture's expressions", () => {
  const gesture = current({ kind: "gesture" });
  const plan = planTuneSave(
    gesture,
    {
      revision: "rev-1",
      events: [],
      expressions: { angry: [{ v: 1, beat: "peak" }] },
      dependencies: [],
    },
    options,
  );
  assert.deepEqual(plan.clip.events, []);
  assert.deepEqual(plan.clip.expressions, gesture.clip.expressions);
  assert.deepEqual(plan.meta.dependencies, []);
});

test("refuses sounds closer than 0.3 s and sounds on starter idles", () => {
  assert.deepEqual(
    eventIssues([
      { id: "a", time: 0.1, kind: "avatar_vfx" },
      { id: "b", time: 0.2, kind: "avatar_vfx", playAccompanyingSound: false },
      { id: "c", time: 0.4, kind: "sfx" },
    ]),
    [],
  );
  assert.equal(
    eventIssues([
      { id: "a", time: 0.1, kind: "avatar_vfx" },
      { id: "c", time: 0.2, kind: "sfx" },
    ]).length,
    1,
  );
  assert.equal(
    eventIssues([{ id: "c", time: 0.2, kind: "sfx" }], { idle: true }).length,
    1,
  );
  assert.throws(
    () =>
      planTuneSave(
        current({ contentId: "builtin:gesture:idle-sway", kind: "gesture" }),
        {
          revision: "rev-1",
          events: [{ id: "pop", time: 0.6, kind: "sfx", cueId: "pop" }],
          dependencies: [
            { ref: POP, alias: "pop", content_type: "sound_effect" },
          ],
        },
        { ...options, idleKeys: new Set(["builtin:gesture:idle-sway"]) },
      ),
    /starter idle/,
  );
});

test("reads the starter idle keys from the loadout's seed", () => {
  assert.deepEqual(
    starterIdleKeys({
      idle: {
        default: ["builtin:gesture:a"],
        cells: { joy: { 1: ["builtin:gesture:b"], 2: ["builtin:gesture:a"] } },
      },
    }),
    new Set(["builtin:gesture:a", "builtin:gesture:b"]),
  );
  assert.throws(() => starterIdleKeys({ gestures: [] }), TuneSaveError);
});

test("reads the starter idle keys from the tracked starter loadout", async () => {
  const policy = JSON.parse(
    await readFile(path.join(REPO_ROOT, STARTER_LOADOUT), "utf8"),
  );
  assert.ok(starterIdleKeys(policy).size > 0);
});

test("reports the pack sounds content needs added or no longer uses", () => {
  assert.deepEqual(
    packChanges(
      [
        { dependencies: [{ ref: DING, content_type: "sound_effect" }] },
        { dependencies: [{ ref: STAR, content_type: "avatar_effect" }] },
      ],
      new Set([POP]),
    ),
    { additions: [DING], removals: [POP] },
  );
});
