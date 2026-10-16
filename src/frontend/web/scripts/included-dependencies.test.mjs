import assert from "node:assert/strict";
import test from "node:test";

import {
  includedActionDependencies,
  packSoundRefs,
} from "./included-dependencies.mjs";

const includedTypes = new Map([
  ["builtin:particle-effect:hearts", "particle_effect"],
]);
const packSounds = packSoundRefs({
  files: [
    { path: "sfx/wow-comedy/bubble_pop_01.ogg" },
    { path: "sfx/wow-comedy/bubble_pop_01.meta.json" },
  ],
});
const pop = {
  alias: "pop",
  ref: "builtin:sound-effect:bubble_pop_01",
  content_type: "sound_effect",
};
const popEvent = { id: "pop", time: 0.2, kind: "sfx", cueId: "pop" };

test("lists the pack's sounds by content ID", () => {
  assert.deepEqual(packSounds, new Set(["builtin:sound-effect:bubble_pop_01"]));
});

test("writes a pack sound an sfx event plays as an optional edge", () => {
  assert.deepEqual(
    includedActionDependencies([pop], [popEvent], {
      includedTypes,
      packSounds,
    }),
    [{ ...pop, config: {}, optional: true }],
  );
});

test("refuses a sound that is neither Included nor in the pack", () => {
  assert.throws(
    () =>
      includedActionDependencies(
        [{ ...pop, ref: "builtin:sound-effect:unknown" }],
        [popEvent],
        { includedTypes, packSounds },
      ),
    /not Included content/,
  );
  // Without the pack's sounds, a pack sound is refused as before.
  assert.throws(
    () => includedActionDependencies([pop], [popEvent], { includedTypes }),
    /not Included content/,
  );
});

test("keeps a pack sound optional when a loose copy is Included too", () => {
  const [edge] = includedActionDependencies([pop], [popEvent], {
    includedTypes: new Map([[pop.ref, "sound_effect"]]),
    packSounds,
  });
  assert.equal(edge.optional, true);
});

test("refuses a pack sound declared as another content type", () => {
  assert.throws(
    () =>
      includedActionDependencies(
        [{ ...pop, content_type: "avatar_effect" }],
        [],
        { includedTypes, packSounds },
      ),
    /is a sound_effect/,
  );
});
