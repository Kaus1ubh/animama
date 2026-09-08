import assert from "node:assert/strict";
import test from "node:test";

import {
  reactionNameFromRunId,
  validateReactionClipDocument,
  validateReactionMetadata,
} from "./creator-reaction.ts";

function clip() {
  return {
    schema: "animaPoseClip/1.0",
    id: "react-0827123456",
    name: "react-0827123456",
    duration: 1.2,
    defaultTransition: {
      easing: "easeInOutSine",
      interpolation: { expression: "linear" },
    },
    poses: {
      "expression-1": { expressions: { happy: 1 } },
      "expression-2": { expressions: { angry: 1 } },
    },
    poseKeyframes: [
      { time: 0, pose: "expression-1" },
      { time: 0.3, pose: "expression-2" },
    ],
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

test("rejects extra landmarks, events, and positive Happy at the second pose", () => {
  assert.throws(
    () =>
      validateReactionClipDocument(
        {
          ...clip(),
          poseKeyframes: [
            ...clip().poseKeyframes,
            { time: 0.6, pose: "expression-2" },
          ],
        },
        "react-0827123456",
      ),
    /exactly two poses and keyframes/,
  );
  assert.throws(
    () =>
      validateReactionClipDocument(
        { ...clip(), events: [{ id: "unexpected", time: 0.2 }] },
        "react-0827123456",
      ),
    /must not contain events/,
  );
  const wrongSecond = {
    ...clip(),
    poses: {
      ...clip().poses,
      "expression-2": { expressions: { angry: 1, happy: 0.2 } },
    },
  };
  assert.throws(
    () => validateReactionClipDocument(wrongSecond, "react-0827123456"),
    /second expressions/,
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
