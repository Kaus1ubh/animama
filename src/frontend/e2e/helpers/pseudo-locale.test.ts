import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDataStrings,
  customExpressionNames,
  FIXED_WORDS,
  prepareExclusions,
  pseudoLocalize,
  reviewSurface,
  unexcludedText,
  unmarkedText,
  type VisibleText,
} from "./pseudo-locale.ts";

const exclusions = prepareExclusions({
  dataStrings: [
    "Annie",
    "Star",
    "Stronger than laugh_mild, lighter than laugh_hard.",
    "  ",
  ],
  identifiers: ["Fcl_ALL_Angry"],
  words: FIXED_WORDS,
});

/** A glTF binary holding only a JSON chunk. */
function glb(json: unknown): Uint8Array {
  const body = Buffer.from(JSON.stringify(json));
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt32LE(body.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, body]);
}

test("pseudo markers cover whole strings and strings split across nodes", () => {
  assert.equal(unmarkedText(pseudoLocalize("Save changes")), "");
  assert.equal(unmarkedText(`${pseudoLocalize("Chat with")} Annie`), " Annie");
  // `<Trans>` output: the first and last pieces carry one marker each.
  assert.equal(unmarkedText("⟦Ŕéáð "), "");
  assert.equal(unmarkedText(" ƒíŕšţ ·····⟧"), "");
  assert.equal(unmarkedText("Save changes"), "Save changes");
});

test("data strings, data shapes and fixed words are excluded", () => {
  for (const text of [
    "Annie",
    "Stronger than laugh_mild, lighter than laugh_hard.",
    "flare-star.png",
    "#ffc0cb",
    "emitter-1",
    "120 px",
    "1.5x",
    "Animama",
    "日本語",
    "English",
    "PocketTTS",
    "X",
    "Fcl ALL Angry",
  ])
    assert.equal(unexcludedText(text, exclusions), "", text);
});

test("interface words stay reported", () => {
  assert.equal(unexcludedText("Save changes", exclusions), "Save changes");
  assert.equal(unexcludedText("built-in", exclusions), "built in");
  assert.equal(unexcludedText("px", exclusions), "px");
  assert.equal(unexcludedText("Annie is typing", exclusions), "is typing");
  assert.equal(unexcludedText("Starry", exclusions), "Starry");
});

test("only an Avatar's own expressions in VRM and VRMA files are data", () => {
  assert.deepEqual(
    customExpressionNames(
      glb({
        meshes: [{ extras: { targetNames: ["Fcl_EYE_Close", 3] } }, {}],
        extensions: {
          VRMC_vrm: {
            expressions: {
              preset: { happy: {}, blinkLeft: {} },
              custom: { Fcl_ALL_Angry: {} },
            },
          },
        },
      }),
    ),
    ["Fcl_EYE_Close", "Fcl_ALL_Angry"],
  );
  assert.deepEqual(
    customExpressionNames(
      glb({
        extensions: {
          VRM: {
            blendShapeMaster: {
              blendShapeGroups: [
                { name: "Joy", presetName: "joy" },
                { name: "Fcl_MTH_Small", presetName: "unknown" },
              ],
            },
          },
        },
      }),
    ),
    ["Fcl_MTH_Small"],
  );
  assert.deepEqual(customExpressionNames(new Uint8Array(8)), []);
});

test("data strings come from JSON leaves except backend prose", () => {
  const strings = new Set<string>();
  collectDataStrings(
    {
      items: [{ name: "Wave", tags: ["greeting"] }],
      error: { code: "x", message: "Something failed" },
      detail: "Not found",
    },
    strings,
  );
  assert.deepEqual([...strings].sort(), ["Wave", "greeting", "x"]);
});

test("a surface review reports untranslated text and records exclusions once", () => {
  const node = (text: string, enclosed = false): VisibleText => ({
    kind: "text",
    text,
    enclosed,
    context: "main > p",
  });
  const review = reviewSurface(
    "Library",
    [
      node(pseudoLocalize("Library")),
      node("Annie"),
      node("Annie"),
      node("this", true),
      node("Loading…"),
    ],
    exclusions,
  );
  assert.deepEqual(review.excluded, ["Annie"]);
  assert.deepEqual(review.untranslated, [
    {
      surface: "Library",
      kind: "text",
      text: "Loading…",
      unmarked: "Loading",
      context: "main > p",
    },
  ]);
});
