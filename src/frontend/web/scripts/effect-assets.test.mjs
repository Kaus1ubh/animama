import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import sharp from "sharp";

import {
  BUDGETS,
  EFFECT_ART_LIMITS,
  FLIPBOOK_LIMITS,
  RUNTIME_LIMITS,
  assembleFlipbook,
  checkImage,
  fixImage,
  previewImage,
  readRgba,
} from "./effect-assets.mjs";

const run = promisify(execFile);
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "../../../..");
let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "effect-assets-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A PNG of `width`×`height` whose pixels come from `paint(x, y)` → [r, g, b, a].
 * With `alpha: false` the PNG has no alpha channel.
 */
async function png(width, height, paint, { alpha = true } = {}) {
  const channels = alpha ? 4 : 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = paint(x, y);
      data.set(pixel.slice(0, channels), (y * width + x) * channels);
    }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** A red disc of `radius` centred at (cx, cy); `background` paints the rest. */
function disc(cx, cy, radius, background, alpha = 255) {
  return (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
      ? [220, 30, 40, alpha]
      : background(x, y);
}

const clear = () => [0, 0, 0, 0];
const checker = (cell) => (x, y) =>
  (Math.floor(x / cell) + Math.floor(y / cell)) % 2
    ? [204, 204, 204, 255]
    : [255, 255, 255, 255];

function codes(result) {
  return result.issues.map((issue) => `${issue.level}:${issue.code}`);
}

function alphaAt({ data, width }, x, y) {
  return data[(y * width + x) * 4 + 3];
}

test("a clean transparent disc passes", async () => {
  const input = await png(128, 128, disc(64, 64, 60, clear));
  const result = await checkImage(input, { budget: BUDGETS.landmark });
  assert.deepEqual(codes(result), []);
  assert.equal(result.width, 128);
});

test("an image without transparency fails", async () => {
  const input = await png(64, 64, () => [10, 200, 10, 255], { alpha: false });
  assert.ok(codes(await checkImage(input)).includes("FAIL:no_alpha"));
  const opaque = await png(64, 64, () => [10, 200, 10, 255]);
  assert.ok(codes(await checkImage(opaque)).includes("FAIL:no_alpha"));
});

test("an empty image fails", async () => {
  const input = await png(32, 32, clear);
  assert.ok(codes(await checkImage(input)).includes("FAIL:empty"));
});

test("a painted checkerboard is detected and removed", async () => {
  const input = await png(128, 128, disc(64, 64, 40, checker(16)));
  const before = await checkImage(input);
  assert.ok(codes(before).includes("FAIL:checkerboard"), codes(before));
  assert.ok(codes(before).includes("FAIL:no_alpha"));

  const { buffer, report } = await fixImage(input, { removeBackground: true });
  assert.equal(report.background, "checkerboard");
  const fixed = await readRgba(buffer);
  assert.equal(alphaAt(fixed, 64, 64), 255);
  assert.equal(alphaAt(fixed, 2, 2), 0);
  assert.equal(alphaAt(fixed, 120, 10), 0);
  const after = await checkImage(buffer);
  assert.ok(
    !codes(after).some((code) => code.startsWith("FAIL")),
    codes(after),
  );
});

test("a solid painted background is reported and removable", async () => {
  const input = await png(
    96,
    96,
    disc(48, 48, 30, () => [250, 250, 250, 255]),
  );
  assert.ok(codes(await checkImage(input)).includes("WARN:solid_background"));
  const { buffer, report } = await fixImage(input, { removeBackground: true });
  assert.equal(report.background, "solid");
  assert.equal(alphaAt(await readRgba(buffer), 1, 1), 0);
});

test("removing a background that is not there is refused", async () => {
  const input = await png(64, 64, disc(32, 32, 20, clear));
  await assert.rejects(
    fixImage(input, { removeBackground: true }),
    /no painted background/,
  );
});

test("near-opaque art is raised to fully opaque", async () => {
  const input = await png(64, 64, disc(32, 32, 28, clear, 252));
  assert.ok(codes(await checkImage(input)).includes("WARN:near_opaque"));
  const { buffer } = await fixImage(input, {});
  const fixed = await readRgba(buffer);
  assert.equal(alphaAt(fixed, 32, 32), 255);
  assert.ok(!codes(await checkImage(buffer)).includes("WARN:near_opaque"));
});

test("see-through patches inside the art are reported and filled", async () => {
  const input = await png(96, 96, (x, y) => {
    const d = (x - 48) ** 2 + (y - 48) ** 2;
    if (d <= 12 ** 2) return [100, 150, 180, 190];
    return d <= 40 ** 2 ? [120, 170, 200, 255] : [0, 0, 0, 0];
  });
  assert.ok(
    codes(await checkImage(input)).includes("WARN:interior_translucency"),
  );
  const plain = await readRgba((await fixImage(input, {})).buffer);
  assert.equal(alphaAt(plain, 48, 48), 190);
  const solid = await readRgba(
    (await fixImage(input, { solidInterior: true })).buffer,
  );
  assert.equal(alphaAt(solid, 48, 48), 255);
  assert.ok(
    !codes(
      await checkImage(
        await fixImage(input, { solidInterior: true }).then((r) => r.buffer),
      ),
    ).includes("WARN:interior_translucency"),
  );
  // Antialiased edges are not interior.
  const soft = await png(64, 64, (x, y) => {
    const d = Math.hypot(x - 32, y - 32);
    return d <= 20 ? [9, 9, 9, 255] : d <= 22 ? [9, 9, 9, 120] : [0, 0, 0, 0];
  });
  assert.ok(
    !codes(await checkImage(soft)).includes("WARN:interior_translucency"),
  );
});

test("faint alpha noise is cleared", async () => {
  const input = await png(
    64,
    64,
    disc(32, 32, 10, () => [9, 9, 9, 2]),
  );
  const { buffer } = await fixImage(input, { trim: true });
  const fixed = await readRgba(buffer);
  assert.equal(alphaAt(fixed, 0, 0), 0);
  assert.ok(fixed.width <= 21, `trimmed to the disc, got ${fixed.width}`);
});

test("transparent padding is trimmed, squared and padded", async () => {
  const input = await png(200, 120, disc(40, 60, 15, clear));
  assert.ok(codes(await checkImage(input)).includes("WARN:padding"));
  const trimmed = await fixImage(input, { trim: true });
  assert.equal(trimmed.report.width, 31);
  assert.equal(trimmed.report.height, 31);
  const squared = await readRgba(
    (await fixImage(input, { trim: true, pad: 4, square: true })).buffer,
  );
  assert.equal(squared.width, 39);
  assert.equal(squared.height, 39);
  assert.equal(alphaAt(squared, 19, 19), 255);
  assert.equal(alphaAt(squared, 1, 1), 0);
});

test("face-surface art keeps its margins", async () => {
  const input = await png(256, 256, disc(60, 200, 20, clear));
  assert.ok(codes(await checkImage(input)).includes("WARN:padding"));
  assert.ok(
    !codes(await checkImage(input, { budget: BUDGETS.surface })).includes(
      "WARN:padding",
    ),
  );
});

test("tall art squared to fit is not flagged for padding", async () => {
  const tall = await png(80, 200, (x, y) =>
    Math.abs(x - 40) < 30 && Math.abs(y - 100) < 95
      ? [40, 120, 220, 255]
      : [0, 0, 0, 0],
  );
  const { buffer } = await fixImage(tall, { trim: true, pad: 8, square: true });
  const found = codes(await checkImage(buffer));
  assert.ok(!found.includes("WARN:padding"), found);
});

test("oversized art fails its budget and is resized to fit", async () => {
  const input = await png(1024, 768, disc(512, 384, 300, clear));
  const result = await checkImage(input, { budget: BUDGETS.landmark });
  assert.ok(codes(result).includes("FAIL:budget_dimension"));
  const { buffer, report } = await fixImage(input, {
    maxDimension: BUDGETS.landmark.maxDimension,
  });
  assert.equal(report.width, 512);
  assert.equal(report.height, 384);
  assert.ok(
    !codes(await checkImage(buffer, { budget: BUDGETS.landmark })).some(
      (code) => code.startsWith("FAIL"),
    ),
  );
  // Never enlarge.
  const small = await fixImage(await png(40, 40, disc(20, 20, 18, clear)), {
    maxDimension: 512,
  });
  assert.equal(small.report.width, 40);
});

test("a file over its byte budget fails", async () => {
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed & 255;
  };
  const input = await png(256, 256, () => [
    noise(),
    noise(),
    noise(),
    255 - (noise() & 1),
  ]);
  const result = await checkImage(input, {
    budget: { maxDimension: 512, maxKiB: 16 },
  });
  assert.ok(codes(result).includes("FAIL:budget_bytes"), codes(result));
});

test("runtime limits match the app and the definition contract", async () => {
  const limits = await readFile(
    path.join(
      repoRoot,
      "src/frontend/web/src/lib/avatar/vfx/effect-image-limits.ts",
    ),
    "utf8",
  );
  assert.match(limits, /MAX_AVATAR_EFFECT_IMAGE_BYTES = 16 \* 1024 \* 1024;/);
  assert.equal(RUNTIME_LIMITS.bytes, 16 * 1024 * 1024);
  assert.match(limits, /MAX_AVATAR_EFFECT_IMAGE_DIMENSION = 4096;/);
  assert.equal(RUNTIME_LIMITS.dimension, 4096);
  assert.match(limits, /MAX_AVATAR_EFFECT_IMAGE_PIXELS = 4096 \* 4096;/);
  assert.equal(RUNTIME_LIMITS.pixels, 4096 * 4096);
  const contract = await readFile(
    path.join(repoRoot, "src/backend/animama/app/contracts/avatar_effect.py"),
    "utf8",
  );
  assert.match(
    contract,
    new RegExp(`MAX_FLIPBOOK_GRID = ${FLIPBOOK_LIMITS.grid}\\n`),
  );
  assert.match(
    contract,
    new RegExp(`MAX_FLIPBOOK_FRAMES = ${FLIPBOOK_LIMITS.frames}\\n`),
  );
  assert.match(
    contract,
    new RegExp(`MAX_FLIPBOOK_FPS = ${FLIPBOOK_LIMITS.fps}\\.0\\n`),
  );
  assert.match(
    contract,
    /FlipbookLoop = Literal\["loop", "once", "pingpong"\]/,
  );
});

test("particle and scene budgets carry their kind's hard limits", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        "src/frontend/web/src/lib/content/fixtures/effect-art-limits.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(EFFECT_ART_LIMITS, fixture);
  for (const name of ["particle-texture", "particle-sheet"])
    assert.equal(BUDGETS[name].limits, EFFECT_ART_LIMITS.particleTexture, name);
  for (const name of ["scene-sticker", "scene-tile", "scene-background"])
    assert.equal(BUDGETS[name].limits, EFFECT_ART_LIMITS.sceneImage, name);
  // Each budget fits inside its hard limits.
  for (const budget of Object.values(BUDGETS)) {
    const limits = budget.limits ?? RUNTIME_LIMITS;
    assert.ok(budget.maxDimension <= limits.dimension);
    assert.ok(budget.maxKiB * 1024 <= limits.bytes);
  }
});

test("art over a particle texture's hard limit fails with that limit", async () => {
  const input = await png(2050, 8, (x) =>
    x < 1000 ? [200, 40, 40, 255] : [0, 0, 0, 0],
  );
  const result = await checkImage(input, {
    budget: BUDGETS["particle-texture"],
  });
  const issue = result.issues.find((entry) => entry.code === "dimension_limit");
  assert.ok(issue, codes(result));
  assert.match(issue.message, /2048 px limit/);
});

test("opaque tiles and backgrounds pass where transparency is optional", async () => {
  const input = await png(256, 256, (x, y) =>
    (x + y) % 64 < 32 ? [250, 180, 200, 255] : [255, 230, 240, 255],
  );
  for (const name of ["scene-tile", "scene-background"]) {
    const found = codes(await checkImage(input, { budget: BUDGETS[name] }));
    assert.ok(
      !found.some((code) => code.startsWith("FAIL")),
      `${name}: ${found}`,
    );
    assert.ok(!found.includes("WARN:opaque_border"), `${name}: ${found}`);
  }
  const sticker = codes(
    await checkImage(input, { budget: BUDGETS["scene-sticker"] }),
  );
  assert.ok(sticker.includes("FAIL:no_alpha"), sticker);
  // A checkerboard painted where transparency should be still fails.
  const painted = await png(256, 256, disc(128, 128, 60, checker(16)));
  const tile = codes(
    await checkImage(painted, { budget: BUDGETS["scene-tile"] }),
  );
  assert.ok(tile.includes("FAIL:checkerboard"), tile);
  assert.ok(!tile.includes("FAIL:no_alpha"), tile);
});

test("particle sheets share the flipbook grid limit", () => {
  assert.equal(EFFECT_ART_LIMITS.particleTexture.grid, FLIPBOOK_LIMITS.grid);
});

test("faint alpha is treated as transparent by check, as fix clears it", async () => {
  const input = await png(
    256,
    256,
    disc(128, 128, 30, () => [9, 9, 9, 2]),
  );
  const found = codes(await checkImage(input, { budget: BUDGETS.landmark }));
  assert.ok(found.includes("WARN:padding"), found);
  assert.ok(found.includes("WARN:faint_alpha"), found);
  assert.ok(!found.includes("WARN:interior_translucency"), found);
});

test("trim keeps faint alpha the caller chose to keep", async () => {
  const input = await png(160, 160, (x, y) => {
    const d = Math.hypot(x - 80, y - 80);
    return d <= 30 ? [200, 0, 0, 255] : d <= 60 ? [200, 0, 0, 3] : [0, 0, 0, 0];
  });
  const kept = await fixImage(input, { trim: true, clearBelow: 1 });
  assert.equal(kept.report.width, 121);
  const cleared = await fixImage(input, { trim: true });
  assert.equal(cleared.report.width, 61);
});

test("pad is added in output pixels after shrinking", async () => {
  const input = await png(300, 300, disc(150, 150, 140, clear));
  const { buffer } = await fixImage(input, {
    trim: true,
    pad: 4,
    maxDimension: 64,
  });
  const fixed = await readRgba(buffer);
  assert.equal(fixed.width, 64);
  assert.equal(alphaAt(fixed, 3, 32), 0);
  assert.ok(alphaAt(fixed, 6, 32) > 0);
  await assert.rejects(
    fixImage(input, { pad: 40, maxDimension: 64 }),
    /no room/,
  );
});

test("painted face tints are not flagged as see-through", async () => {
  const input = await png(128, 128, (x, y) =>
    x > 20 && x < 108 && y > 20 && y < 108 ? [30, 0, 60, 120] : [0, 0, 0, 0],
  );
  assert.ok(
    codes(await checkImage(input)).includes("WARN:interior_translucency"),
  );
  assert.ok(
    !codes(await checkImage(input, { budget: BUDGETS.surface })).includes(
      "WARN:interior_translucency",
    ),
  );
});

test("fixed edges carry the art's colour into transparent pixels", async () => {
  const input = await png(64, 64, disc(32, 32, 20, checker(8)));
  const fixed = await readRgba(
    (await fixImage(input, { removeBackground: true })).buffer,
  );
  // Just outside the disc: transparent, but red rather than checker grey, so
  // linear filtering shows no light fringe.
  const offset = (32 * fixed.width + 54) * 4;
  assert.equal(fixed.data[offset + 3], 0);
  assert.ok(fixed.data[offset] > 150 && fixed.data[offset + 1] < 100);
});

test("a preview shows the art on three backdrops", async () => {
  const preview = await readRgba(
    await previewImage(await png(64, 32, disc(16, 16, 10, clear))),
  );
  assert.equal(preview.width, 192);
  assert.equal(preview.height, 32);
  // Dark backdrop, then light, then the art itself in each tile.
  assert.ok(preview.data[(2 * 192 + 60) * 4] < 80);
  assert.ok(preview.data[(2 * 192 + 124) * 4] > 200);
  assert.equal(preview.data[(16 * 192 + 16) * 4], 220);
  assert.equal(preview.data[(16 * 192 + 144) * 4], 220);
});

test("art is framed at a set size on a fixed canvas", async () => {
  const input = await png(300, 200, disc(220, 60, 30, clear));
  const { buffer } = await fixImage(input, { canvas: { size: 128, art: 40 } });
  const framed = await readRgba(buffer);
  assert.equal(framed.width, 128);
  assert.equal(framed.height, 128);
  assert.equal(alphaAt(framed, 64, 64), 255);
  assert.equal(alphaAt(framed, 64, 40), 0);
  assert.equal(alphaAt(framed, 64, 45), 255);
  await assert.rejects(
    fixImage(input, { canvas: { size: 128, art: 40 }, pad: 4 }),
    /canvas sets the size/,
  );
});

test("flipbook cells can be taller than wide", async () => {
  const frames = [
    await png(100, 100, disc(50, 50, 40, clear)),
    await png(100, 100, disc(50, 50, 40, clear)),
  ];
  const { buffer } = await assembleFlipbook(frames, {
    cell: { width: 32, height: 64 },
  });
  const sheet = await readRgba(buffer);
  assert.equal(sheet.width, 64);
  assert.equal(sheet.height, 64);
  assert.equal(alphaAt(sheet, 16, 32), 255);
  assert.equal(alphaAt(sheet, 16, 2), 0);
});

test("flipbook trim crops every frame to one shared box", async () => {
  const frames = [
    await png(100, 100, disc(30, 50, 10, clear)),
    await png(100, 100, disc(70, 50, 10, clear)),
  ];
  const { buffer, flipbook } = await assembleFlipbook(frames, { trim: true });
  assert.equal(flipbook.columns, 2);
  const sheet = await readRgba(buffer);
  // Shared box: x 20–80, y 40–60 → 61×21 cells; each disc keeps its side.
  assert.equal(sheet.width, 122);
  assert.equal(sheet.height, 21);
  assert.equal(alphaAt(sheet, 10, 10), 255);
  assert.equal(alphaAt(sheet, 50, 10), 0);
  assert.equal(alphaAt(sheet, 61 + 50, 10), 255);
  assert.equal(alphaAt(sheet, 61 + 10, 10), 0);
});

test("frames are assembled on a grid with a flipbook fragment", async () => {
  const frames = await Promise.all(
    [0, 1, 2, 3, 4].map((index) =>
      png(32, 32, disc(16, 16, 4 + index * 2, clear)),
    ),
  );
  const { buffer, flipbook } = await assembleFlipbook(frames, { fps: 10 });
  assert.deepEqual(flipbook, {
    columns: 3,
    rows: 2,
    frames: 5,
    fps: 10,
    loop: "loop",
  });
  const sheet = await readRgba(buffer);
  assert.equal(sheet.width, 96);
  assert.equal(sheet.height, 64);
  // Frame 4 (second row, second column) is centred in its cell.
  assert.equal(alphaAt(sheet, 48, 48), 255);
  assert.equal(alphaAt(sheet, 80, 48), 0);

  const columns = await assembleFlipbook(frames, { columns: 5 });
  assert.equal(columns.flipbook.rows, 1);
});

test("frames fitted into a cell stay fully opaque", async () => {
  const frames = await Promise.all(
    [0, 1, 2].map((index) =>
      png(300, 300, disc(150, 150, 100 + index * 20, clear)),
    ),
  );
  const { buffer } = await assembleFlipbook(frames, { cell: 96 });
  const found = codes(await checkImage(buffer));
  assert.ok(!found.includes("WARN:near_opaque"), found);
  assert.ok(!found.includes("WARN:faint_alpha"), found);
  const sheet = await readRgba(buffer);
  const partial = [];
  for (let offset = 3; offset < sheet.data.length; offset += 4)
    if (sheet.data[offset] >= 250 && sheet.data[offset] < 255)
      partial.push(offset);
  assert.equal(partial.length, 0);
});

test("flipbook frames of different sizes need a cell", async () => {
  const frames = [
    await png(32, 32, disc(16, 16, 10, clear)),
    await png(40, 20, disc(20, 10, 8, clear)),
  ];
  await assert.rejects(assembleFlipbook(frames, {}), /same size.*--cell/s);
  const { buffer, flipbook } = await assembleFlipbook(frames, { cell: 24 });
  assert.equal(flipbook.frames, 2);
  const sheet = await readRgba(buffer);
  assert.equal(sheet.width, 48);
  assert.equal(sheet.height, 24);
});

test("flipbooks outside the contract limits are refused", async () => {
  const frame = await png(2, 2, () => [1, 2, 3, 255]);
  await assert.rejects(
    assembleFlipbook([frame, frame], { columns: FLIPBOOK_LIMITS.grid + 1 }),
    /columns/,
  );
  await assert.rejects(
    assembleFlipbook(Array(FLIPBOOK_LIMITS.frames + 1).fill(frame), {}),
    /frames/,
  );
  const wide = await png(1100, 4, () => [1, 2, 3, 255]);
  await assert.rejects(
    assembleFlipbook([wide, wide, wide, wide], { columns: 4 }),
    /4096/,
  );
});

test("the command line checks, fixes and never overwrites its input", async () => {
  const script = path.join(scriptsDir, "effect-assets.mjs");
  const bad = path.join(dir, "bad.png");
  await writeFile(bad, await png(64, 64, disc(32, 32, 20, checker(8))));
  const failed = await run(process.execPath, [script, "check", bad]).catch(
    (error) => error,
  );
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /FAIL .*bad\.png: .*checkerboard/);

  const fixed = path.join(dir, "fixed.png");
  const ok = await run(process.execPath, [
    script,
    "fix",
    bad,
    "--out",
    fixed,
    "--remove-background",
    "--trim",
    "--budget",
    "landmark",
  ]);
  assert.match(ok.stdout, /PASS .*fixed\.png/);

  const json = await run(process.execPath, [script, "check", fixed, "--json"]);
  assert.equal(JSON.parse(json.stdout)[0].issues.length, 0);

  const notImage = path.join(dir, "notes.png");
  await writeFile(notImage, "not an image");
  const batch = await run(process.execPath, [
    script,
    "check",
    notImage,
    fixed,
  ]).catch((error) => error);
  assert.equal(batch.code, 1);
  assert.match(batch.stdout, /FAIL .*notes\.png: cannot read .*\[unreadable\]/);
  assert.match(batch.stdout, /PASS .*fixed\.png/);
  const unreadableFix = await run(process.execPath, [
    script,
    "fix",
    notImage,
    "--out",
    path.join(dir, "never.png"),
  ]).catch((error) => error);
  assert.equal(unreadableFix.code, 2);
  assert.match(unreadableFix.stdout, /cannot read/);

  const unreadablePreview = await run(process.execPath, [
    script,
    "preview",
    notImage,
    "--out",
    path.join(dir, "never-preview.png"),
  ]).catch((error) => error);
  assert.equal(unreadablePreview.code, 2);
  assert.match(unreadablePreview.stdout, /cannot read .*notes\.png/);

  const link = path.join(dir, "link.png");
  await symlink(bad, link);
  const viaLink = await run(process.execPath, [
    script,
    "fix",
    bad,
    "--out",
    link,
  ]).catch((error) => error);
  assert.equal(viaLink.code, 2);
  assert.match(viaLink.stdout, /never overwrites/);

  const webp = await run(process.execPath, [
    script,
    "flipbook",
    fixed,
    "--out",
    path.join(dir, "sheet.webp"),
  ]).catch((error) => error);
  assert.equal(webp.code, 2);

  const same = await run(process.execPath, [
    script,
    "fix",
    bad,
    "--out",
    bad,
  ]).catch((error) => error);
  assert.equal(same.code, 2);
  assert.match(same.stdout, /never overwrites/);

  const sheet = path.join(dir, "sheet.png");
  const book = await run(process.execPath, [
    script,
    "flipbook",
    fixed,
    fixed,
    "--out",
    sheet,
    "--fps",
    "8",
  ]);
  assert.deepEqual(JSON.parse(book.stdout.slice(book.stdout.indexOf("{"))), {
    flipbook: { columns: 2, rows: 1, frames: 2, fps: 8, loop: "loop" },
  });
});
