import assert from "node:assert/strict";
import test from "node:test";

import {
  appliedStorageKey,
  applyDraft,
  applyEffectSound,
  effectSoundsStorageKey,
  readEffectSounds,
  staleEffectSounds,
  discardApplied,
  readApplied,
  saveAllRequest,
  staleApplied,
  writeApplied,
} from "./applied.ts";
import { draftOf, setExpressionPeak } from "./draft.ts";
import type { TuneItem } from "./model.ts";

function reaction(stem: string, revision = "rev-1"): TuneItem {
  return {
    kind: "reaction",
    stem,
    contentId: `builtin:reaction:${stem}`,
    name: stem,
    emotion: "joy",
    intensity: 2,
    revision,
    dependencies: [],
    clip: {
      id: stem,
      duration: 2,
      expressions: { happy: [{ v: 0.5, beat: "peak" }] },
      events: [],
    },
  };
}

/** A minimal in-memory `Storage`. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

test("applies, re-applies and drops drafts equal to the file", () => {
  const item = reaction("joy-2");
  const edited = setExpressionPeak(draftOf(item), "happy", 0.8, "peak");
  let applied = applyDraft({}, item, edited);
  assert.deepEqual(Object.keys(applied), [item.contentId]);
  assert.equal(applied[item.contentId].revision, "rev-1");

  // Re-applying keeps the revision the first edit was made from.
  applied = applyDraft(applied, { ...item, revision: "rev-2" }, edited);
  assert.equal(applied[item.contentId].revision, "rev-1");

  // A first apply records the revision the edit started from.
  assert.equal(
    applyDraft({}, { ...item, revision: "rev-3" }, edited, "rev-1")[
      item.contentId
    ].revision,
    "rev-1",
  );

  // A draft back to the file's content has nothing left to save.
  assert.deepEqual(applyDraft(applied, item, draftOf(item)), {});
  assert.deepEqual(discardApplied(applied, [item.contentId]), {});
});

test("finds applied edits whose file changed or is gone", () => {
  const first = reaction("joy-2");
  const second = reaction("joy-3");
  const applied = {
    ...applyDraft(
      {},
      first,
      setExpressionPeak(draftOf(first), "happy", 1, "peak"),
    ),
    ...applyDraft(
      {},
      second,
      setExpressionPeak(draftOf(second), "happy", 1, "peak"),
    ),
  };
  assert.deepEqual(staleApplied(applied, [first, second]), []);
  assert.deepEqual(staleApplied(applied, [{ ...first, revision: "rev-9" }]), [
    first.contentId,
    second.contentId,
  ]);
});

test("builds the Save all request from the applied revisions", () => {
  const item = reaction("joy-2");
  const applied = applyDraft(
    {},
    item,
    setExpressionPeak(draftOf(item), "happy", 0.8, "peak"),
  );
  const { edits } = saveAllRequest(applied, [{ ...item, revision: "rev-2" }]);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].revision, "rev-1");
  assert.equal(edits[0].stem, "joy-2");
  assert.deepEqual(edits[0].expressions, {
    happy: [{ v: 0.8, beat: "peak" }],
  });
});

test("keeps applied edits in storage and survives unreadable storage", () => {
  const storage = memoryStorage();
  const key = appliedStorageKey("checkout-a");
  const item = reaction("joy-2");
  const applied = applyDraft(
    {},
    item,
    setExpressionPeak(draftOf(item), "happy", 0.8, "peak"),
  );
  writeApplied(storage, key, applied);
  assert.deepEqual(readApplied(storage, key), applied);
  // Another checkout keeps its own.
  assert.deepEqual(readApplied(storage, appliedStorageKey("checkout-b")), {});
  writeApplied(storage, key, {});
  assert.equal(storage.getItem(key), null);
  // An entry of another shape is left out; the rest load.
  storage.setItem(
    key,
    JSON.stringify({ ...applied, "builtin:reaction:old": { draft: {} } }),
  );
  assert.deepEqual(readApplied(storage, key), applied);
  storage.setItem(key, "{ broken");
  assert.deepEqual(readApplied(storage, key), {});
  assert.deepEqual(readApplied(undefined, key), {});
});

test("keeps effect sound changes and builds them into Save all", () => {
  const effect = {
    kind: "avatar" as const,
    contentType: "avatar_effect" as const,
    contentId: "builtin:avatar-effect:sweat_drop",
    stem: "sweat_drop",
    name: "Sweat Drop",
    sounds: { "on-apply": "builtin:sound-effect:funny_sweat_02" },
    soundAlias: "on-apply",
    revision: "eff-1",
  };
  const DING = "builtin:sound-effect:ding_02";
  let changes = applyEffectSound({}, effect, DING);
  assert.deepEqual(changes, {
    [effect.contentId]: { revision: "eff-1", sound: DING },
  });
  assert.deepEqual(staleEffectSounds(changes, [effect]), []);
  assert.deepEqual(staleEffectSounds(changes, [{ ...effect, revision: "x" }]), [
    effect.contentId,
  ]);
  assert.deepEqual(saveAllRequest({}, [], changes), {
    edits: [],
    effects: [{ contentId: effect.contentId, revision: "eff-1", sound: DING }],
  });
  // Choosing the file's own sound again leaves nothing to save.
  changes = applyEffectSound(changes, effect, effect.sounds["on-apply"]);
  assert.deepEqual(changes, {});
  // Silence is a change too.
  assert.equal(
    applyEffectSound({}, effect, null)[effect.contentId].sound,
    null,
  );
  const storage = memoryStorage();
  const key = effectSoundsStorageKey("checkout-a");
  storage.setItem(
    key,
    JSON.stringify({
      ...applyEffectSound({}, effect, DING),
      broken: { sound: 3 },
    }),
  );
  assert.deepEqual(Object.keys(readEffectSounds(storage, key)), [
    effect.contentId,
  ]);
});
