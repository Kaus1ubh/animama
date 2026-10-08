import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  gestureProject,
  parseSaveItems,
  planSaves,
} from "./animation-save.mjs";

const itemsFile = path.join("/work", "batch", "items.json");
const item = {
  clip: "../clips/wave.clip.json",
  name: "Wave Hello",
  aiDescription: "A friendly wave.",
  selectorId: "wave_hello",
};

test("resolves clips beside the items file and trims texts", () => {
  const [parsed] = parseSaveItems(
    [{ ...item, name: " Wave Hello " }],
    itemsFile,
  );
  assert.deepEqual(parsed, {
    ...item,
    clip: path.join("/work", "clips", "wave.clip.json"),
    // The Library description defaults to the AI description.
    description: "A friendly wave.",
  });
  assert.equal(
    parseSaveItems([{ ...item, description: "Waves hello." }], itemsFile)[0]
      .description,
    "Waves hello.",
  );
});

test("names the item and field of each problem", () => {
  assert.throws(() => parseSaveItems([], itemsFile), /non-empty array/);
  assert.throws(
    () => parseSaveItems([{ ...item, aiDescription: " " }], itemsFile),
    /item 1: "aiDescription"/,
  );
  assert.throws(
    () => parseSaveItems([{ ...item, selectorId: "Wave-Hello" }], itemsFile),
    /snake_case/,
  );
  assert.throws(
    () => parseSaveItems([item, { ...item, clip: "b.json" }], itemsFile),
    /item 2: Selector ID "wave_hello" repeats/,
  );
});

test("imports a new Gesture as a creator project with its Selector ID", () => {
  const sequence = { schema: "animaPoseClip/2.0" };
  assert.deepEqual(
    gestureProject(parseSaveItems([item], itemsFile)[0], sequence),
    {
      schema: "animamaActionProject/1.0",
      intent: "gesture",
      name: "Wave Hello",
      description: "A friendly wave.",
      aiDescription: "A friendly wave.",
      semanticKey: "wave_hello",
      sequence,
      dependencies: [],
    },
  );
});

test("revises a Local Gesture by Selector ID and refuses an Included one", () => {
  const items = parseSaveItems(
    [item, { ...item, clip: "b.json", selectorId: "shy_wave" }],
    itemsFile,
  );
  const library = [
    {
      item_id: "i1",
      source: "included",
      semantic_key: "wave_hello",
      name: "Wave",
    },
    {
      item_id: "l1",
      source: "local",
      semantic_key: "wave_hello",
      name: "Wave Hello",
    },
  ];
  assert.deepEqual(planSaves(items, library), [
    { itemId: "l1", name: "Wave Hello" },
    null,
  ]);
  // A rename could change the Selector ID in the creator, so it is refused.
  assert.throws(
    () => planSaves(items, [{ ...library[1], name: "My Wave" }]),
    /saved as "My Wave": keep that name/,
  );
  assert.throws(
    () => planSaves(items, library.slice(0, 1)),
    /"wave_hello" belongs to an Included Gesture/,
  );
});
