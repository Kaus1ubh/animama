import assert from "node:assert/strict";
import test from "node:test";

import { effectSounds, planEffectSound } from "./content-tune-effects.mjs";

const SWEAT = "builtin:sound-effect:funny_sweat_02";
const POP = "builtin:sound-effect:bubble_pop_01";
const BELL = "builtin:sound-effect:ding_02";
const packSounds = new Set([SWEAT, POP, BELL]);
const edge = (ref, alias) => ({
  ref,
  content_type: "sound_effect",
  alias,
  optional: true,
});

function effect(dependencies, soundAlias) {
  return {
    content_type: "avatar_effect",
    content_id: "builtin:avatar-effect:sweat_drop",
    dependencies,
    definition: {
      schema: "animama/avatar-effect/2",
      ...(soundAlias ? { soundAlias } : {}),
    },
  };
}

test("reads an effect's declared sounds and default", () => {
  assert.deepEqual(
    effectSounds(effect([edge(SWEAT, "on-apply")], "on-apply")),
    {
      sounds: { "on-apply": SWEAT },
      soundAlias: "on-apply",
    },
  );
  assert.deepEqual(effectSounds(effect([], undefined)), {
    sounds: {},
    soundAlias: null,
  });
});

test("replaces the default sound under its alias", () => {
  const next = planEffectSound(
    effect([edge(SWEAT, "on-apply")], "on-apply"),
    POP,
    { packSounds },
  );
  assert.deepEqual(next.dependencies, [edge(POP, "on-apply")]);
  assert.equal(next.definition.soundAlias, "on-apply");
  assert.equal(next.definition.schema, "animama/avatar-effect/2");
});

test("gives a silent effect an optional on-apply sound", () => {
  const next = planEffectSound(effect([], undefined), POP, { packSounds });
  assert.deepEqual(next.dependencies, [edge(POP, "on-apply")]);
  assert.equal(next.definition.soundAlias, "on-apply");
});

test("removes a single sound, but not a merged effect's default", () => {
  const single = planEffectSound(
    effect([edge(SWEAT, "on-apply")], "on-apply"),
    null,
    { packSounds },
  );
  assert.deepEqual(single.dependencies, []);
  assert.equal("soundAlias" in single.definition, false);
  const merged = effect(
    [edge(SWEAT, "on-apply"), edge(BELL, "bell")],
    "on-apply",
  );
  assert.throws(
    () => planEffectSound(merged, null, { packSounds }),
    /several sounds/,
  );
  // Picking a sound a merged effect already declares makes it the default.
  const picked = planEffectSound(merged, BELL, { packSounds });
  assert.deepEqual(picked.dependencies, merged.dependencies);
  assert.equal(picked.definition.soundAlias, "bell");
  // A new sound replaces only the default edge.
  const replaced = planEffectSound(merged, POP, { packSounds });
  assert.deepEqual(replaced.dependencies, [
    edge(POP, "on-apply"),
    edge(BELL, "bell"),
  ]);
});

test("refuses a sound outside the catalog and the pack", () => {
  assert.throws(
    () =>
      planEffectSound(effect([], undefined), "builtin:sound-effect:nope", {
        packSounds,
      }),
    /not a sound/,
  );
});
