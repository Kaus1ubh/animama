import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { EffectRenderFailure, renderEffectSheets } from "./effect-render.mjs";
import { resolveEffectSource } from "./effect-render-sources.mjs";

// Real WebGL renders of Included effects on both Included Avatars, plus an
// effect whose image cannot decode: its controller warning fails the run.
test("renders effect sheets and fails on a controller warning", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-render-"));
  try {
    const broken = path.join(dir, "broken");
    await mkdir(broken);
    await writeFile(path.join(broken, "broken.png"), "not an image");
    await writeFile(
      path.join(broken, "broken.json"),
      JSON.stringify({
        content_type: "avatar_effect",
        name: "Broken",
        definition: {
          schema: "animama/avatar-effect/2",
          region: "full_face",
          attachment: { kind: "face_surface", part: "face_skin", area: "full" },
          art: { image: "broken.png" },
        },
      }),
    );
    const effects = await Promise.all(
      ["library:eye", "library:texture_sick_1", broken].map((spec) =>
        resolveEffectSource(spec),
      ),
    );
    const tile = { width: 96, height: 120 };
    const error = await renderEffectSheets({
      effects,
      outFileFor: (effect) => path.join(dir, `${effect.stem}.png`),
      times: [0.1, 0.5],
      tile,
    }).then(
      () => null,
      (rejection) => rejection,
    );

    assert.ok(error instanceof EffectRenderFailure, String(error));
    const [hover, texture, failed] = error.results;
    for (const result of [hover, texture]) {
      assert.deepEqual(result.failures, [], result.stem);
      assert.deepEqual(
        result.avatars.map((avatar) => avatar.activeEffectIds.length),
        [1, 1],
      );
      const png = await readFile(result.outFile);
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      // 64 px labels + 2 Avatars × 3 views wide; 28 px header + 2 rows tall.
      assert.equal(png.readUInt32BE(16), 64 + 6 * tile.width);
      assert.equal(png.readUInt32BE(20), 28 + 2 * tile.height);
    }
    assert.equal(failed.stem, "broken");
    assert.match(failed.failures.join("\n"), /warning: Failed to load VFX/);
    assert.match(error.message, /^broken: /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
