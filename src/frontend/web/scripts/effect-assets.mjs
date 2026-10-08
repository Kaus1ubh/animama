import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Check and fix Avatar Effect art before it goes into an effect folder.
 *
 *   pnpm -s effects:assets check <png...> [--budget <name>] [--json]
 *   pnpm -s effects:assets fix <in.png> --out <out.png> [options]
 *   pnpm -s effects:assets flipbook <frame.png...> --out <sheet.png> [options]
 *   pnpm -s effects:assets preview <png> --out <preview.png>
 *
 * It works on any PNG, generated or hand-made. Image generators often return
 * art on a painted checkerboard or a flat backdrop, with "opaque" pixels at
 * alpha 250–254 and wide transparent margins; `check` reports these and
 * `fix` repairs them. `fix` also bleeds the art's edge colour into the fully
 * transparent pixels around it, so texture filtering shows no light or dark
 * fringe. `flipbook` lays frames out on the grid `art.flipbook` describes and
 * prints that definition fragment. `preview` shows art on a dark, a light and
 * a checkered backdrop, which exposes halos and see-through patches that a
 * single backdrop hides.
 */

/** Mirrors `src/lib/avatar/vfx/effect-image-limits.ts`; a test keeps them equal. */
export const RUNTIME_LIMITS = {
  bytes: 16 * 1024 * 1024,
  dimension: 4096,
  pixels: 4096 * 4096,
};

/** Mirrors the `/2` contract (`app/contracts/avatar_effect.py`); a test keeps them equal. */
export const FLIPBOOK_LIMITS = { grid: 16, frames: 256, fps: 60 };

/**
 * Size budgets per attachment. Effects are small on screen; larger art only
 * costs memory and upload time. A brief may justify a larger budget.
 */
export const BUDGETS = {
  /** Floating face art: eyes, emotes, marks above the head. */
  landmark: { maxDimension: 512, maxKiB: 256 },
  /**
   * Painted on the face. The image is laid over the face texture's UV
   * layout, so its margins position the art and must not be trimmed.
   */
  surface: { maxDimension: 1024, maxKiB: 512, keepsLayout: true },
  body: { maxDimension: 512, maxKiB: 256 },
  sticker: { maxDimension: 512, maxKiB: 256 },
  silhouette: { maxDimension: 1024, maxKiB: 512 },
  /** A whole flipbook sheet; keep each frame near 256 px. */
  flipbook: { maxDimension: 2048, maxKiB: 1024 },
};

/** Alpha at or above this counts as meant to be opaque. */
export const DEFAULT_OPAQUE_FROM = 250;
/** Alpha below this is invisible noise and is cleared. */
export const DEFAULT_CLEAR_BELOW = 4;
/** Colour distance (RGB, 0–441) within which a pixel matches the backdrop. */
const BACKGROUND_TOLERANCE = 28;
/** Pixels this close to a transparent pixel count as edge, not interior. */
const EDGE_RADIUS = 3;
/** Passes of edge-colour bleed into transparent pixels. */
const BLEED_PASSES = 8;

export class EffectAssetError extends Error {}

/**
 * Decoded pixels accepted from a source image: four times the app's limit
 * (8192 × 8192), so oversized generated art can still be shrunk by `fix`
 * while a hostile file cannot expand without bound.
 */
const MAX_SOURCE_PIXELS = RUNTIME_LIMITS.pixels * 4;

/** Open an untrusted image with the source pixel limit. */
function openImage(input) {
  return sharp(input, { limitInputPixels: MAX_SOURCE_PIXELS });
}

function describe(input) {
  return Buffer.isBuffer(input) ? "the image" : input;
}

/** Read an image's header; an unreadable file becomes an `EffectAssetError`. */
export async function readMetadata(input) {
  try {
    return await openImage(input).metadata();
  } catch (error) {
    throw new EffectAssetError(
      `cannot read ${describe(input)} as an image (${error.message})`,
    );
  }
}

/** Decode any image to straight (non-premultiplied) RGBA. */
export async function readRgba(input) {
  const metadata = await readMetadata(input);
  let decoded;
  try {
    decoded = await openImage(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new EffectAssetError(
      `cannot decode ${describe(input)} (${error.message})`,
    );
  }
  const { data, info } = decoded;
  return {
    data,
    width: info.width,
    height: info.height,
    format: metadata.format,
    hadAlpha: Boolean(metadata.hasAlpha),
  };
}

function distance(data, offset, color) {
  return Math.hypot(
    data[offset] - color[0],
    data[offset + 1] - color[1],
    data[offset + 2] - color[2],
  );
}

/** Offsets of the outer ring of pixels, about 2% of the short side thick. */
function borderOffsets(width, height) {
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  const offsets = [];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      if (x < ring || y < ring || x >= width - ring || y >= height - ring)
        offsets.push((y * width + x) * 4);
  return offsets;
}

/**
 * Classify the border: "none" (mostly transparent), "solid" (one flat colour),
 * "checkerboard" (two light neutral colours, as generators paint
 * transparency) or "opaque" (other art reaching the edges).
 */
export function detectBackground({ data, width, height }) {
  const border = borderOffsets(width, height);
  const opaque = border.filter((offset) => data[offset + 3] >= 250);
  if (opaque.length < border.length * 0.9) return { kind: "none", colors: [] };
  // Cluster by 8-level buckets, then merge buckets close to a larger one.
  const buckets = new Map();
  for (const offset of opaque) {
    const key = [0, 1, 2].map((c) => data[offset + c] >> 3).join(",");
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bucket.count += 1;
    for (let c = 0; c < 3; c += 1) bucket.sum[c] += data[offset + c];
    buckets.set(key, bucket);
  }
  const clusters = [];
  for (const bucket of [...buckets.values()].sort(
    (a, b) => b.count - a.count,
  )) {
    const color = bucket.sum.map((v) => v / bucket.count);
    const near = clusters.find(
      (cluster) =>
        Math.hypot(...cluster.color.map((v, c) => v - color[c])) <=
        BACKGROUND_TOLERANCE,
    );
    if (near) near.count += bucket.count;
    else clusters.push({ color, count: bucket.count });
  }
  clusters.sort((a, b) => b.count - a.count);
  const share = (cluster) => (cluster?.count ?? 0) / opaque.length;
  const [first, second] = clusters;
  if (share(first) >= 0.9) return { kind: "solid", colors: [first.color] };
  const neutralLight = ({ color }) =>
    Math.max(...color) - Math.min(...color) <= 24 &&
    (color[0] + color[1] + color[2]) / 3 >= 128;
  if (
    second &&
    share(first) + share(second) >= 0.9 &&
    share(second) >= 0.2 &&
    neutralLight(first) &&
    neutralLight(second)
  )
    return { kind: "checkerboard", colors: [first.color, second.color] };
  return { kind: "opaque", colors: [] };
}

/**
 * Mark pixels within `radius` of a transparent pixel (alpha below
 * `clearBelow`) or the image edge. Anything else visible is the art's
 * interior.
 */
function edgeMask(
  { data, width, height },
  { radius = EDGE_RADIUS, clearBelow = 1 } = {},
) {
  const transparent = new Uint8Array(width * height);
  for (let index = 0; index < transparent.length; index += 1)
    transparent[index] = data[index * 4 + 3] < clearBelow ? 1 : 0;
  // Separable square dilation; the image border counts as transparent.
  const rows = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let hit = x < radius || x >= width - radius;
      for (let dx = -radius; !hit && dx <= radius; dx += 1)
        hit = transparent[y * width + x + dx] === 1;
      rows[y * width + x] = hit ? 1 : 0;
    }
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let hit = y < radius || y >= height - radius;
      for (let dy = -radius; !hit && dy <= radius; dy += 1)
        hit = rows[(y + dy) * width + x] === 1;
      mask[y * width + x] = hit ? 1 : 0;
    }
  return mask;
}

/**
 * Pixel statistics `check` reports on. Alpha below `clearBelow` counts as
 * transparent, as `fix` clears it, so faint noise neither hides margins nor
 * looks like see-through art.
 */
function measure(
  { data, width, height },
  { opaqueFrom = DEFAULT_OPAQUE_FROM, clearBelow = DEFAULT_CLEAR_BELOW } = {},
) {
  let visible = 0;
  let faint = 0;
  let nearOpaque = 0;
  let belowOpaque = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < 255) belowOpaque += 1;
      if (alpha === 0) continue;
      if (alpha < clearBelow) {
        faint += 1;
        continue;
      }
      visible += 1;
      if (alpha >= opaqueFrom && alpha < 255) nearOpaque += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  const edge = edgeMask({ data, width, height }, { clearBelow });
  let interiorTranslucent = 0;
  for (let index = 0; index < edge.length; index += 1) {
    const alpha = data[index * 4 + 3];
    if (!edge[index] && alpha >= clearBelow && alpha < opaqueFrom)
      interiorTranslucent += 1;
  }
  const bounds =
    maxX < 0
      ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return {
    visible,
    faint,
    nearOpaque,
    belowOpaque,
    interiorTranslucent,
    bounds,
  };
}

function budgetIssues({ width, height, bytes }, budget) {
  const issues = [];
  const longest = Math.max(width, height);
  if (
    longest > RUNTIME_LIMITS.dimension ||
    width * height > RUNTIME_LIMITS.pixels
  )
    issues.push({
      level: "FAIL",
      code: "dimension_limit",
      message: `${width}×${height} exceeds the app's ${RUNTIME_LIMITS.dimension} px limit`,
    });
  if (bytes > RUNTIME_LIMITS.bytes)
    issues.push({
      level: "FAIL",
      code: "bytes_limit",
      message: `${kib(bytes)} KiB exceeds the app's 16 MiB limit`,
    });
  if (budget && longest > budget.maxDimension)
    issues.push({
      level: "FAIL",
      code: "budget_dimension",
      message: `${width}×${height} exceeds the ${budget.maxDimension} px budget; fix --max ${budget.maxDimension}`,
    });
  if (budget && bytes > budget.maxKiB * 1024)
    issues.push({
      level: "FAIL",
      code: "budget_bytes",
      message: `${kib(bytes)} KiB exceeds the ${budget.maxKiB} KiB budget; simplify the art or lower its size`,
    });
  return issues;
}

const kib = (bytes) => Math.ceil(bytes / 1024);

/**
 * Check one image. Returns its size and a list of `{ level, code, message }`
 * issues; FAIL issues make the art unusable as is, WARN issues are worth a look.
 */
export async function checkImage(input, { budget } = {}) {
  const bytes = Buffer.isBuffer(input)
    ? input.length
    : (await stat(input)).size;
  const image = await readRgba(input);
  const { width, height } = image;
  const issues = [];
  if (image.format !== "png")
    issues.push({
      level: "FAIL",
      code: "not_png",
      message: `${image.format} image; effect art is PNG (fix writes one)`,
    });
  const stats = measure(image);
  const background = detectBackground(image);
  if (!image.hadAlpha || stats.belowOpaque === 0)
    issues.push({
      level: "FAIL",
      code: "no_alpha",
      message: "no transparency; the art must sit on a transparent background",
    });
  if (stats.visible === 0)
    issues.push({ level: "FAIL", code: "empty", message: "no visible pixels" });
  if (background.kind === "checkerboard")
    issues.push({
      level: "FAIL",
      code: "checkerboard",
      message:
        "a checkerboard is painted where transparency should be; fix --remove-background",
    });
  else if (background.kind === "solid")
    issues.push({
      level: "WARN",
      code: "solid_background",
      message:
        "a flat colour fills the border; if it is a backdrop, fix --remove-background",
    });
  else if (background.kind === "opaque")
    issues.push({
      level: "WARN",
      code: "opaque_border",
      message: "opaque art reaches the edges; check it is not cropped",
    });
  if (stats.visible > 0 && stats.nearOpaque / stats.visible > 0.02)
    issues.push({
      level: "WARN",
      code: "near_opaque",
      message: `${Math.round((stats.nearOpaque / stats.visible) * 100)}% of the art is at alpha ${DEFAULT_OPAQUE_FROM}–254; fix makes it fully opaque`,
    });
  if (stats.faint > width * height * 0.01)
    issues.push({
      level: "WARN",
      code: "faint_alpha",
      message: `${stats.faint} pixels hold faint alpha (below ${DEFAULT_CLEAR_BELOW}); fix clears them`,
    });
  // Painted face tints are meant to be see-through; only floating art is
  // expected to be solid inside.
  if (
    !budget?.keepsLayout &&
    stats.visible > 0 &&
    stats.interiorTranslucent / stats.visible > 0.01
  )
    issues.push({
      level: "WARN",
      code: "interior_translucency",
      message: `${Math.round((stats.interiorTranslucent / stats.visible) * 100)}% of the art's inside is see-through; unless the brief wants that (glows, tears), fix --solid-interior`,
    });
  // Wide margins on every side waste texture space. Art that reaches two
  // opposite edges (a tall drop squared with `--square`) is already tight.
  if (stats.bounds && background.kind === "none" && !budget?.keepsLayout) {
    const { bounds } = stats;
    if (Math.max(bounds.width / width, bounds.height / height) < 0.85)
      issues.push({
        level: "WARN",
        code: "padding",
        message: `the art fills ${bounds.width}×${bounds.height} of ${width}×${height}; fix --trim (with --pad/--square)`,
      });
  }
  issues.push(...budgetIssues({ width, height, bytes }, budget));
  return { width, height, bytes, issues };
}

/** Clear every pixel connected to the border that matches the backdrop. */
function removeBackground(image) {
  const background = detectBackground(image);
  if (background.kind !== "solid" && background.kind !== "checkerboard")
    throw new EffectAssetError(
      "no painted background found on the border; nothing to remove",
    );
  const { data, width, height } = image;
  const matches = (index, tolerance) =>
    data[index * 4 + 3] > 0 &&
    background.colors.some(
      (color) => distance(data, index * 4, color) <= tolerance,
    );
  const removed = new Uint8Array(width * height);
  const queue = [];
  for (const offset of borderOffsets(width, height)) {
    const index = offset / 4;
    if (matches(index, BACKGROUND_TOLERANCE)) {
      removed[index] = 1;
      queue.push(index);
    }
  }
  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!removed[next] && matches(next, BACKGROUND_TOLERANCE)) {
        removed[next] = 1;
        queue.push(next);
      }
    }
  }
  // One more ring: antialiased pixels blending art into the backdrop.
  const edge = [];
  for (let index = 0; index < removed.length; index += 1) {
    if (removed[index]) continue;
    const x = index % width;
    const touches =
      (x > 0 && removed[index - 1]) ||
      (x < width - 1 && removed[index + 1]) ||
      removed[index - width] ||
      removed[index + width];
    if (touches && matches(index, BACKGROUND_TOLERANCE * 2)) edge.push(index);
  }
  for (const index of edge) removed[index] = 1;
  for (let index = 0; index < removed.length; index += 1)
    if (removed[index]) data[index * 4 + 3] = 0;
  return background.kind;
}

function applyAlphaThresholds({ data }, clearBelow, opaqueFrom) {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] < clearBelow) data[offset] = 0;
    else if (data[offset] >= opaqueFrom) data[offset] = 255;
  }
}

/**
 * Give fully transparent pixels the average colour of their visible
 * neighbours, a few pixels deep. Their alpha stays 0; this only changes what
 * bilinear filtering and mipmaps blend in at the art's edge.
 */
function bleedEdges({ data, width, height }) {
  const filled = new Uint8Array(width * height);
  for (let index = 0; index < filled.length; index += 1)
    filled[index] = data[index * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < BLEED_PASSES; pass += 1) {
    const updates = [];
    for (let index = 0; index < filled.length; index += 1) {
      if (filled[index]) continue;
      const x = index % width;
      const y = (index - x) / width;
      const sum = [0, 0, 0];
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!filled[next]) continue;
          for (let c = 0; c < 3; c += 1) sum[c] += data[next * 4 + c];
          count += 1;
        }
      if (count) updates.push([index, sum.map((v) => Math.round(v / count))]);
    }
    if (!updates.length) break;
    for (const [index, color] of updates) {
      data.set(color, index * 4);
      filled[index] = 1;
    }
  }
  for (let index = 0; index < filled.length; index += 1)
    if (!filled[index]) data.fill(0, index * 4, index * 4 + 3);
}

function rawImage(image) {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  });
}

async function toRgba(pipeline) {
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Repair one image and return `{ buffer, report }`, a PNG and what changed.
 * Steps run in a fixed order: remove the backdrop, trim, square, resize so
 * the result including `pad` fits `maxDimension` (never enlarging), pad in
 * output pixels, clear faint alpha, raise near-opaque alpha, make the
 * interior opaque (`solidInterior`; edges keep their antialiasing), bleed
 * edge colour, encode.
 */
export async function fixImage(
  input,
  {
    removeBackground: remove = false,
    solidInterior = false,
    trim = false,
    square = false,
    pad = 0,
    maxDimension,
    clearBelow = DEFAULT_CLEAR_BELOW,
    opaqueFrom = DEFAULT_OPAQUE_FROM,
  } = {},
) {
  const source = await readRgba(input);
  let image = { data: source.data, width: source.width, height: source.height };
  const report = {
    from: { width: image.width, height: image.height },
    background: null,
  };
  if (remove) report.background = removeBackground(image);
  // Faint noise must not hold the trim box open.
  applyAlphaThresholds(image, clearBelow, 256);
  if (trim) {
    const { bounds } = measure(image, { clearBelow });
    if (!bounds) throw new EffectAssetError("no visible pixels to keep");
    image = await toRgba(
      rawImage(image).extract({
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }),
    );
  }
  if (square && image.width !== image.height) {
    const side = Math.max(image.width, image.height);
    const extraX = side - image.width;
    const extraY = side - image.height;
    image = await toRgba(
      rawImage(image).extend({
        left: Math.floor(extraX / 2),
        right: Math.ceil(extraX / 2),
        top: Math.floor(extraY / 2),
        bottom: Math.ceil(extraY / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      }),
    );
  }
  if (maxDimension) {
    const inner = maxDimension - 2 * pad;
    if (inner < 1)
      throw new EffectAssetError(
        `--pad ${pad} leaves no room inside ${maxDimension} px`,
      );
    if (Math.max(image.width, image.height) > inner)
      image = await toRgba(
        rawImage(image).resize({
          width: inner,
          height: inner,
          fit: "inside",
          kernel: "lanczos3",
        }),
      );
  }
  if (pad)
    image = await toRgba(
      rawImage(image).extend({
        left: pad,
        right: pad,
        top: pad,
        bottom: pad,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      }),
    );
  applyAlphaThresholds(image, clearBelow, opaqueFrom);
  if (solidInterior) {
    const edge = edgeMask(image);
    for (let index = 0; index < edge.length; index += 1)
      if (!edge[index] && image.data[index * 4 + 3] > 0)
        image.data[index * 4 + 3] = 255;
  }
  bleedEdges(image);
  const buffer = await rawImage(image)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return {
    buffer,
    report: {
      ...report,
      width: image.width,
      height: image.height,
      bytes: buffer.length,
    },
  };
}

/**
 * Lay frames out left to right, top to bottom, as `art.flipbook` reads them.
 * Frames must share one size unless `cell` (px) is given; each frame is then
 * fitted inside a square cell and centred. Returns the sheet and the
 * definition fragment.
 */
export async function assembleFlipbook(
  frames,
  { columns, cell, fps = 12, loop = "loop" } = {},
) {
  if (!frames.length) throw new EffectAssetError("a flipbook needs frames");
  if (frames.length > FLIPBOOK_LIMITS.frames)
    throw new EffectAssetError(
      `${frames.length} frames exceed the ${FLIPBOOK_LIMITS.frames} frames a flipbook allows`,
    );
  if (!(fps > 0 && fps <= FLIPBOOK_LIMITS.fps))
    throw new EffectAssetError(
      `fps must be above 0 and at most ${FLIPBOOK_LIMITS.fps}`,
    );
  if (!["loop", "once", "pingpong"].includes(loop))
    throw new EffectAssetError("loop must be loop, once or pingpong");
  const count = frames.length;
  const cols = columns ?? Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  if (!Number.isInteger(cols) || cols < 1 || cols > FLIPBOOK_LIMITS.grid)
    throw new EffectAssetError(`columns must be 1–${FLIPBOOK_LIMITS.grid}`);
  if (rows > FLIPBOOK_LIMITS.grid)
    throw new EffectAssetError(
      `${count} frames need ${rows} rows; the grid allows ${FLIPBOOK_LIMITS.grid}, so add columns`,
    );
  // Sizes come from the headers, so a sheet over the limit is refused before
  // any frame is decoded; frames are then decoded one at a time.
  const headers = [];
  for (const frame of frames) headers.push(await readMetadata(frame));
  let cellWidth;
  let cellHeight;
  if (cell) {
    cellWidth = cellHeight = cell;
  } else {
    const sizes = new Set(
      headers.map((header) => `${header.width}×${header.height}`),
    );
    if (sizes.size > 1)
      throw new EffectAssetError(
        `frames must be the same size (found ${[...sizes].join(", ")}); pass --cell <px> to fit them`,
      );
    cellWidth = headers[0].width;
    cellHeight = headers[0].height;
  }
  const width = cols * cellWidth;
  const height = rows * cellHeight;
  if (Math.max(width, height) > RUNTIME_LIMITS.dimension)
    throw new EffectAssetError(
      `the sheet would be ${width}×${height}, over the app's ${RUNTIME_LIMITS.dimension} px limit; use --cell or fewer columns`,
    );
  const composites = [];
  for (const [index, frame] of frames.entries()) {
    let image = await readRgba(frame);
    if (cell)
      image = await toRgba(
        rawImage(image).resize({
          width: cell,
          height: cell,
          fit: "inside",
          withoutEnlargement: true,
          kernel: "lanczos3",
        }),
      );
    // Resampling brings back faint and near-opaque alpha; settle it per frame
    // so the sheet ships as clean as fixed single images.
    applyAlphaThresholds(image, DEFAULT_CLEAR_BELOW, DEFAULT_OPAQUE_FROM);
    bleedEdges(image);
    composites.push({
      input: await rawImage(image).png().toBuffer(),
      left:
        (index % cols) * cellWidth + Math.floor((cellWidth - image.width) / 2),
      top:
        Math.floor(index / cols) * cellHeight +
        Math.floor((cellHeight - image.height) / 2),
    });
  }
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return {
    buffer,
    flipbook: { columns: cols, rows, frames: count, fps, loop },
  };
}

/** Backdrops for `preview`: chat-like dark, paper light, and a checkerboard. */
const PREVIEW_BACKDROPS = ["#3a3f4a", "#f4f1ea", "checker"];

/** Place the art on each preview backdrop side by side, at most 384 px each. */
export async function previewImage(input) {
  await readMetadata(input);
  let art;
  try {
    art = await openImage(input)
      .ensureAlpha()
      .resize({
        width: 384,
        height: 384,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (error) {
    throw new EffectAssetError(
      `cannot decode ${describe(input)} (${error.message})`,
    );
  }
  const { width, height } = await sharp(art).metadata();
  const tiles = await Promise.all(
    PREVIEW_BACKDROPS.map(async (backdrop) => {
      let base;
      if (backdrop === "checker") {
        const data = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y += 1)
          for (let x = 0; x < width; x += 1)
            data.fill(
              (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 200 : 240,
              (y * width + x) * 3,
              (y * width + x) * 3 + 3,
            );
        base = sharp(data, { raw: { width, height, channels: 3 } });
      } else {
        base = sharp({
          create: { width, height, channels: 3, background: backdrop },
        });
      }
      return base
        .composite([{ input: art }])
        .png()
        .toBuffer();
    }),
  );
  return sharp({
    create: {
      width: width * tiles.length,
      height,
      channels: 3,
      background: "#000000",
    },
  })
    .composite(
      tiles.map((tile, index) => ({
        input: tile,
        left: index * width,
        top: 0,
      })),
    )
    .png()
    .toBuffer();
}

const USAGE = [
  "Usage:",
  "  pnpm -s effects:assets check <png...> [--budget <name>] [--json]",
  "  pnpm -s effects:assets fix <in.png> --out <out.png> [options]",
  "  pnpm -s effects:assets flipbook <frame.png...> --out <sheet.png> [--columns N] [--cell px] [--fps 12] [--loop loop|once|pingpong]",
  "  pnpm -s effects:assets preview <png> --out <preview.png>    art on dark, light and checkered backdrops",
  "",
  `Budgets: ${Object.entries(BUDGETS)
    .map(([name, b]) => `${name} (${b.maxDimension} px, ${b.maxKiB} KiB)`)
    .join(", ")}.`,
  "",
  "fix options:",
  "  --remove-background    clear a painted checkerboard or flat backdrop",
  "  --solid-interior       make see-through patches inside the art opaque",
  "  --trim                 crop transparent margins",
  "  --square               pad to a square, centred",
  "  --pad <px>             transparent margin on every side, in output pixels",
  "  --max <px>             shrink so the longest side fits (never enlarges)",
  "  --budget <name>        --max from the budget, then check against it",
  `  --opaque-from <1-256>  raise alpha at or above this to 255; 256 turns it off (default ${DEFAULT_OPAQUE_FROM})`,
  `  --clear-below <0-255>  clear alpha below this (default ${DEFAULT_CLEAR_BELOW})`,
  "",
  "check exits 1 when any image has a FAIL; fix exits 1 when its output does.",
  "fix never overwrites its input.",
].join("\n");

const VALUE_OPTIONS = new Set([
  "--out",
  "--budget",
  "--pad",
  "--max",
  "--opaque-from",
  "--clear-below",
  "--columns",
  "--cell",
  "--fps",
  "--loop",
]);
const FLAG_OPTIONS = new Set([
  "--json",
  "--remove-background",
  "--solid-interior",
  "--trim",
  "--square",
  "--help",
]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const values = {};
  const flags = new Set();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (FLAG_OPTIONS.has(arg)) flags.add(arg);
    else if (VALUE_OPTIONS.has(arg)) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new EffectAssetError(`${arg} needs a value.`);
      values[arg] = value;
      index += 1;
    } else if (arg.startsWith("--"))
      throw new EffectAssetError(`Unknown option ${arg}.`);
    else positional.push(arg);
  }
  return { command, positional, values, flags };
}

function integer(values, name, min, max) {
  if (values[name] === undefined) return undefined;
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new EffectAssetError(
      `${name} must be an integer from ${min} to ${max}.`,
    );
  return value;
}

function budgetFor(values) {
  const name = values["--budget"];
  if (name === undefined) return undefined;
  const budget = BUDGETS[name];
  if (!budget)
    throw new EffectAssetError(
      `Unknown budget ${name}; use ${Object.keys(BUDGETS).join(", ")}.`,
    );
  return budget;
}

/**
 * True when `out` already names the same file as one of `inputs`, including
 * through a symlink or a case-insensitive file system.
 */
async function overwritesInput(out, inputs) {
  const target = await stat(out).catch(() => null);
  if (!target) return false;
  for (const input of inputs) {
    const source = await stat(input).catch(() => null);
    if (source && source.dev === target.dev && source.ino === target.ino)
      return true;
  }
  return false;
}

function printCheck(file, result, cwd) {
  const relative = path.relative(cwd, file);
  const label = !relative || relative.startsWith("..") ? file : relative;
  const size = `${result.width}×${result.height}, ${kib(result.bytes)} KiB`;
  const fails = result.issues.filter((issue) => issue.level === "FAIL");
  if (!result.issues.length) console.log(`PASS ${label} (${size})`);
  for (const issue of result.issues)
    console.log(`${issue.level} ${label}: ${issue.message} [${issue.code}]`);
  if (result.issues.length && !fails.length)
    console.log(`PASS ${label} (${size}) with warnings`);
  return fails.length === 0;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  const { command, positional, values, flags } = parsed;
  if (!command || command === "--help" || flags.has("--help")) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const resolve = (file) => path.resolve(cwd, file);
  try {
    const budget = budgetFor(values);
    if (command === "check") {
      if (!positional.length) throw new EffectAssetError("check needs images.");
      const results = [];
      let ok = true;
      for (const file of positional.map(resolve)) {
        let result;
        try {
          result = await checkImage(file, { budget });
        } catch (error) {
          if (!(error instanceof EffectAssetError) && error.code !== "ENOENT")
            throw error;
          // Report and keep checking the rest of the batch.
          result = {
            width: 0,
            height: 0,
            bytes: 0,
            issues: [
              { level: "FAIL", code: "unreadable", message: error.message },
            ],
          };
        }
        results.push({ file, ...result });
        if (!flags.has("--json")) ok = printCheck(file, result, cwd) && ok;
        else ok = ok && !result.issues.some((issue) => issue.level === "FAIL");
      }
      if (flags.has("--json")) console.log(JSON.stringify(results, null, 2));
      return ok ? 0 : 1;
    }
    if (command === "fix") {
      if (positional.length !== 1 || !values["--out"])
        throw new EffectAssetError("fix takes one image and --out <out.png>.");
      const input = resolve(positional[0]);
      const out = resolve(values["--out"]);
      if (path.extname(out).toLowerCase() !== ".png")
        throw new EffectAssetError("--out must be a .png file.");
      if (await overwritesInput(out, [input]))
        throw new EffectAssetError(
          "fix never overwrites its input; choose another --out.",
        );
      if (
        budget?.keepsLayout &&
        (flags.has("--trim") || flags.has("--square") || values["--pad"])
      )
        throw new EffectAssetError(
          "face-surface art is laid over the face texture; keep its size and margins (no --trim, --square or --pad).",
        );
      const { buffer, report } = await fixImage(input, {
        removeBackground: flags.has("--remove-background"),
        solidInterior: flags.has("--solid-interior"),
        trim: flags.has("--trim"),
        square: flags.has("--square"),
        pad: integer(values, "--pad", 0, 1024) ?? 0,
        maxDimension:
          integer(values, "--max", 1, RUNTIME_LIMITS.dimension) ??
          budget?.maxDimension,
        opaqueFrom:
          integer(values, "--opaque-from", 1, 256) ?? DEFAULT_OPAQUE_FROM,
        clearBelow:
          integer(values, "--clear-below", 0, 255) ?? DEFAULT_CLEAR_BELOW,
      });
      await writeFile(out, buffer);
      console.log(
        `Fixed ${report.from.width}×${report.from.height} → ${report.width}×${report.height}` +
          (report.background
            ? `, removed ${report.background} background`
            : ""),
      );
      return printCheck(out, await checkImage(out, { budget }), cwd) ? 0 : 1;
    }
    if (command === "flipbook") {
      if (!positional.length || !values["--out"])
        throw new EffectAssetError(
          "flipbook takes frames and --out <sheet.png>.",
        );
      const out = resolve(values["--out"]);
      const inputs = positional.map(resolve);
      if (path.extname(out).toLowerCase() !== ".png")
        throw new EffectAssetError("--out must be a .png file.");
      if (await overwritesInput(out, inputs))
        throw new EffectAssetError(
          "flipbook never overwrites a frame; choose another --out.",
        );
      const fps =
        values["--fps"] === undefined ? undefined : Number(values["--fps"]);
      const { buffer, flipbook } = await assembleFlipbook(inputs, {
        columns: integer(values, "--columns", 1, FLIPBOOK_LIMITS.grid),
        cell: integer(values, "--cell", 1, RUNTIME_LIMITS.dimension),
        fps,
        loop: values["--loop"],
      });
      await writeFile(out, buffer);
      const sheet = await checkImage(out, {
        budget: budget ?? BUDGETS.flipbook,
      });
      const ok = printCheck(out, sheet, cwd);
      console.log("Definition fragment for art:");
      console.log(JSON.stringify({ flipbook }, null, 2));
      return ok ? 0 : 1;
    }
    if (command === "preview") {
      if (positional.length !== 1 || !values["--out"])
        throw new EffectAssetError(
          "preview takes one image and --out <preview.png>.",
        );
      const input = resolve(positional[0]);
      const out = resolve(values["--out"]);
      if (await overwritesInput(out, [input]))
        throw new EffectAssetError(
          "preview never overwrites its input; choose another --out.",
        );
      await writeFile(out, await previewImage(input));
      console.log(`Preview: ${out}`);
      return 0;
    }
    throw new EffectAssetError(`Unknown command ${command}.`);
  } catch (error) {
    if (!(error instanceof EffectAssetError) && error.code !== "ENOENT")
      throw error;
    console.log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
