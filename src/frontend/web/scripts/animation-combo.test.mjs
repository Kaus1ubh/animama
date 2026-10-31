import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadComboCatalog,
  mediaKey,
  parseComboArgs,
} from "./animation-combo.mjs";

test("parses combo page options", () => {
  assert.deepEqual(parseComboArgs([]), {
    help: false,
    avatars: [
      { value: "Annie", file: false },
      { value: "Andrew", file: false },
    ],
    port: 0,
    open: true,
  });
  assert.deepEqual(
    parseComboArgs([
      "--avatar-file",
      "a.vrm",
      "--avatar",
      "andrew",
      "--port",
      "8790",
      "--no-open",
    ]),
    {
      help: false,
      avatars: [
        { value: "a.vrm", file: true },
        { value: "andrew", file: false },
      ],
      port: 8790,
      open: false,
    },
  );
  assert.deepEqual(parseComboArgs(["--help"]), { help: true });
  for (const [argv, message] of [
    [["--avatar-file"], /needs a value/],
    [["--port", "x"], /Invalid --port/],
    [["--loud"], /Unknown option/],
  ])
    assert.throws(() => parseComboArgs(argv), message);
});

test("keys a dependency's media by content id and config", () => {
  assert.equal(
    mediaKey({ alias: "blush", ref: "builtin:avatar-effect:blush" }),
    "builtin:avatar-effect:blush",
  );
  assert.equal(
    mediaKey({
      alias: "s",
      ref: "builtin:particle-effect:s",
      config: { n: 2 },
    }),
    'builtin:particle-effect:s#{"n":2}',
  );
});

test("lists every Included Gesture and Reaction with shared media", async () => {
  const catalog = await loadComboCatalog();
  assert.ok(catalog.gestures.length > 100);
  assert.ok(catalog.reactions.length > 100);
  const heart = catalog.gestures.find(({ stem }) => stem === "big-arm-heart");
  assert.equal(heart.spec, "library:gesture/big-arm-heart");
  assert.ok(heart.beats.some(({ id }) => id === "heart"));
  // Reactions by emotion, then intensity.
  const joy = catalog.reactions.filter(({ emotion }) => emotion === "joy");
  assert.deepEqual(
    joy.map(({ intensity }) => intensity),
    [...joy.map(({ intensity }) => intensity)].sort((a, b) => a - b),
  );
  // Clip events name their effects by content id, which the media resolves.
  const sparkles = catalog.clips
    .get(heart.spec)
    .events.find((event) => event.kind === "particle_vfx");
  assert.match(sparkles.effectId, /^builtin:particle-effect:/);
  assert.ok(
    catalog.media.particleEffects.some(
      ({ alias }) => alias === sparkles.effectId,
    ),
  );
  assert.deepEqual(catalog.media.notices, []);
});
