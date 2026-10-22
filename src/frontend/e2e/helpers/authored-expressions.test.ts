import assert from "node:assert/strict";
import test from "node:test";

import { authoredExpressionThresholds } from "./authored-expressions.ts";

test("authored thresholds follow VRoid face-part tracks, not a preset", () => {
  assert.deepEqual(
    authoredExpressionThresholds({
      expressions: {
        Fcl_EYE_Joy: [
          { v: 0, beat: "pop" },
          { v: 0.75, beat: "settle" },
        ],
        Fcl_BRW_Surprised: [
          { v: 1, beat: "pop" },
          { v: 0.79, beat: "settle" },
        ],
        Fcl_MTH_Joy: [
          { v: 0, beat: "pop" },
          { v: 0.112, beat: "settle" },
        ],
      },
    }),
    { Fcl_EYE_Joy: 0.4, Fcl_BRW_Surprised: 0.4 },
  );
});

test("authored thresholds keep whole-face presets", () => {
  assert.deepEqual(
    authoredExpressionThresholds(
      { expressions: { happy: [{ v: 0.75 }], relaxed: [{ v: 0.33 }] } },
      0.3,
    ),
    { happy: 0.3, relaxed: 0.3 },
  );
});

test("a clip without a visible expression fails clearly", () => {
  assert.throws(
    () =>
      authoredExpressionThresholds({ expressions: { happy: [{ v: 0.1 }] } }),
    /no expression track that peaks at 0.4 or more/,
  );
  assert.throws(() => authoredExpressionThresholds(null), /no expression/);
});
