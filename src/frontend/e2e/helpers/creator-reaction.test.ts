import assert from "node:assert/strict";
import test from "node:test";

import {
  reactionNameFromRunId,
  validateReactionClipDocument,
  validateReactionMetadata,
} from "./creator-reaction.ts";

function clip() {
  return {
    schema: "animaPoseClip/2.0",
    id: "react-0827123456",
    name: "react-0827123456",
    duration: 1.2,
    beats: [
      { id: "expression", label: "Expression", time: 0, ease: "easeInOutSine" },
      {
        id: "expression-2",
        label: "Expression 2",
        time: 0.3,
        ease: "easeInOutSine",
      },
    ],
    expressions: {
      happy: [
        { beat: "expression", v: 1 },
        { beat: "expression-2", v: 0 },
      ],
      angry: [
        { beat: "expression", v: 0 },
        { beat: "expression-2", v: 1 },
      ],
    },
  };
}

test("derives the Reaction name only from a runner timestamp ID", () => {
  assert.equal(reactionNameFromRunId("run-0827123456"), "react-0827123456");
  assert.throws(
    () => reactionNameFromRunId("manual-0827123456"),
    /requires run-MMDDHHmmss/,
  );
});

test("accepts the exact two-landmark portable Reaction clip", () => {
  assert.deepEqual(
    validateReactionClipDocument(clip(), "react-0827123456"),
    clip(),
  );
});

test("rejects extra beats, events, body tracks and positive Happy at the second beat", () => {
  assert.throws(
    () =>
      validateReactionClipDocument(
        {
          ...clip(),
          beats: [...clip().beats, { id: "more", label: "More", time: 0.6 }],
        },
        "react-0827123456",
      ),
    /exactly two beats/,
  );
  assert.throws(
    () =>
      validateReactionClipDocument(
        { ...clip(), events: [{ id: "unexpected", time: 0.2 }] },
        "react-0827123456",
      ),
    /must not contain events/,
  );
  assert.throws(
    () =>
      validateReactionClipDocument(
        { ...clip(), joints: { head: {} } },
        "react-0827123456",
      ),
    /joints tracks/,
  );
  const wrongSecond = structuredClone(clip());
  wrongSecond.expressions.happy[1].v = 0.2;
  assert.throws(
    () => validateReactionClipDocument(wrongSecond, "react-0827123456"),
    /expression values/,
  );
});

test("validates the readable Reaction descriptor contract", () => {
  const metadata = {
    schema_version: 1,
    content_type: "reaction",
    id: "local:reaction:react-0827123456",
    name: "react-0827123456",
    placement_hint: { emotion: "joy", intensity: 1 },
    implementation: { kind: "anima_clip", file_role: "sequence" },
    files: [{ path: "react-0827123456.json", role: "sequence" }],
    dependencies: [],
  };
  assert.deepEqual(
    validateReactionMetadata(metadata, {
      logicalKey: "local:reaction:react-0827123456",
      name: "react-0827123456",
    }),
    metadata,
  );
});
