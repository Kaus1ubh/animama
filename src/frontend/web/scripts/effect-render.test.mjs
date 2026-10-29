import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artFailures,
  artNote,
  artRegionKind,
  artRegionRect,
  countChangedPixels,
} from "./effect-render.mjs";

const tile = { width: 100, height: 100 };

/** A `width × 1` raw RGBA row with every pixel `rgba`. */
const row = (width, rgba) => Buffer.from(Array(width).fill(rgba).flat());

test("artRegionKind places painted, landmark and body art", () => {
  const kind = (attachment) => artRegionKind({ attachment });
  assert.equal(kind({ kind: "face_surface", area: "full" }), "face");
  assert.equal(kind({ kind: "face_surface", area: "mouth" }), "face");
  // Landmark art may sit beside the feature it is placed at.
  for (const landmark of ["eyes", "mouth", "forehead", "top", "top_edge"])
    assert.equal(kind({ kind: "face_landmark", landmark }), "head");
  for (const other of ["body", "sticker", "silhouette"])
    assert.equal(kind({ kind: other }), "tile");
});

test("artRegionRect grows the head rect for landmark art within the tile", () => {
  const head = { x0: 40, y0: 10, x1: 60, y1: 50 };
  assert.equal(artRegionRect("tile", head, tile), null);
  assert.equal(artRegionRect("face", null, tile), null);
  assert.deepEqual(artRegionRect("face", head, tile), head);
  assert.deepEqual(artRegionRect("head", head, tile), {
    x0: 30,
    y0: 0,
    x1: 70,
    y1: 70,
  });
});

test("countChangedPixels counts channel changes above the threshold", () => {
  const before = row(4, [10, 10, 10, 255]);
  const after = Buffer.concat([
    row(1, [18, 10, 10, 255]), // a change of 8: within the threshold
    row(1, [19, 10, 10, 255]),
    row(1, [10, 10, 10, 200]), // alpha counts too
    row(1, [10, 10, 10, 255]),
  ]);
  assert.deepEqual(countChangedPixels(after, before), {
    changed: 2,
    inside: 2,
  });
  assert.deepEqual(
    countChangedPixels(after, before, {
      rect: { x0: 0, y0: 0, x1: 2, y1: 1 },
      width: 4,
    }),
    { changed: 2, inside: 1 },
  );
  assert.deepEqual(countChangedPixels(after, before, { threshold: 50 }), {
    changed: 1,
    inside: 1,
  });
});

test("artFailures names the effect whose art is not seen where it belongs", () => {
  const measured = (fields) => ({
    kind: "face",
    changed: 400,
    peak: 200,
    peakAt: { time: 1, view: "face" },
    headFound: true,
    wide: { views: ["front", "3/4 right"], changed: 100, inside: 90 },
    ...fields,
  });
  // The floor is VISIBLE_SHARE of a 100 × 100 tile: 10 px.
  assert.deepEqual(artFailures("Andrew", "blush", measured({}), tile), []);
  assert.deepEqual(
    artFailures(
      "Andrew",
      "blush",
      measured({ peak: 9, peakAt: { time: 0.5, view: "three-quarter" } }),
      tile,
    ),
    [
      "Andrew: blush draws nothing visible on the head: at most 9 px changed there in a tile (3/4 right, 0.5s), 10 needed in a tile; 400 px changed in all tiles",
    ],
  );
  // Without a head box the region is the whole tile.
  assert.deepEqual(
    artFailures(
      "Andrew",
      "blush",
      measured({ peak: 0, changed: 0, headFound: false }),
      tile,
    ),
    [
      "Andrew: blush draws nothing visible in the tile: no pixel changed there, 10 needed in a tile; 0 px changed in all tiles",
    ],
  );
  const outside = { wide: { views: ["front"], changed: 100, inside: 40 } };
  assert.deepEqual(artFailures("Andrew", "blush", measured(outside), tile), [
    "Andrew: blush draws mostly outside the head: 40.0% of the 100 px it changes in the front views are on the head (50% needed)",
  ]);
  assert.match(
    artFailures(
      "Andrew",
      "puff",
      measured({ ...outside, kind: "head" }),
      tile,
    )[0],
    /^Andrew: puff draws mostly outside the head: .* are on or around the head/,
  );
  // Body art centred in no tile (in a hand below the frame) is not judged.
  const handArt = { kind: "tile", artId: "glowstick", peak: 0, changed: 0 };
  assert.deepEqual(
    artFailures("Andrew", "glowstick", measured(handArt), tile),
    [],
  );
  assert.match(
    artFailures(
      "Andrew",
      "glowstick",
      measured({ ...handArt, artSeen: true }),
      tile,
    )[0],
    /^Andrew: glowstick draws nothing visible in the tile/,
  );
  // Not judged: art anywhere in the tile, an Avatar without a head rect, or
  // too little art in the wide views (none when only the face view renders).
  for (const fields of [
    { kind: "tile" },
    { headFound: false },
    { wide: { views: ["front"], changed: 9, inside: 0 } },
    { wide: { views: [], changed: 0, inside: 0 } },
  ])
    assert.deepEqual(
      artFailures("Andrew", "blush", measured({ ...outside, ...fields }), tile),
      [],
    );
});

test("artNote says why an effect was not judged", () => {
  assert.equal(
    artNote("Andrew", "glowstick", "outside"),
    "Andrew: glowstick not judged (art outside every tile)",
  );
  assert.equal(
    artNote("Andrew", "puff", "inactive"),
    "Andrew: puff not judged (not active at any rendered time)",
  );
});
