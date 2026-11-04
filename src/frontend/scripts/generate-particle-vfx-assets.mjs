/**
 * Regenerates the Particle Effect creator's curated built-in textures (from
 * generated symbols and the CC0 Kenney and Brackeys packs), their editor
 * manifest and the folder README into a staging directory for review.
 * Particle Effects themselves are authored in the creator, not here.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
// Generate into an explicit staging directory; never overwrite Included content.
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  if (
    !["--output-dir", "--kenney-root", "--brackeys-root"].includes(name) ||
    !args[index + 1] ||
    options.has(name)
  ) {
    throw new Error(
      "Use --output-dir DIR --kenney-root DIR --brackeys-root DIR",
    );
  }
  options.set(name, path.resolve(args[index + 1]));
}
for (const required of ["--output-dir", "--kenney-root", "--brackeys-root"]) {
  if (!options.has(required)) throw new Error(`Missing ${required}`);
}
const particleVfxDir = options.get("--output-dir");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const includedRoot = path.join(repositoryRoot, "content/included");
if (
  particleVfxDir === includedRoot ||
  particleVfxDir.startsWith(`${includedRoot}${path.sep}`)
) {
  throw new Error(
    "Choose a staging directory outside content/included; review outputs before copying.",
  );
}
// Refuse an existing destination to preserve prior results and unrelated files.
await fs.mkdir(particleVfxDir, { recursive: false });
const textureDir = path.join(particleVfxDir, "textures");
const textureManifestPath = path.join(particleVfxDir, "textureManifest.ts");
const kenneyTransparentDir = path.join(
  options.get("--kenney-root"),
  "PNG (Transparent)",
);
const brackeysAlphaDir = path.join(
  options.get("--brackeys-root"),
  "particles/alpha",
);
const brackeysFlipbookDir = path.join(
  options.get("--brackeys-root"),
  "flipbooks",
);
const brackeysPredrawnDir = path.join(
  options.get("--brackeys-root"),
  "predrawn",
);
const runtimeTextureSize = 256;

const TEXTURE_MANIFEST = [
  manifestTexture(
    "soft-dot",
    "Soft Dot",
    "soft-dot.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "glow-soft",
    "Glow Soft",
    "glow-soft.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "glow-sharp",
    "Glow Sharp",
    "glow-sharp.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "flare-star",
    "Flare Star",
    "flare-star.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "brackeys-flare",
    "Flare",
    "brackeys-flare.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "fire-8x8",
    "Fire 8x8",
    "fire-8x8.png",
    "glow",
    "additive",
    0,
    atlas(8, 8, 64),
  ),
  manifestTexture(
    "flame-16x4",
    "Flame 16x4",
    "flame-16x4.png",
    "glow",
    "additive",
    0,
    atlas(16, 4, 64),
  ),
  manifestTexture(
    "kenney-fire-glow",
    "Kenney Fire Glow",
    "kenney-fire-glow.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "kenney-flame-core",
    "Kenney Flame Core",
    "kenney-flame-core.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture(
    "kenney-flame-tongue",
    "Kenney Flame Tongue",
    "kenney-flame-tongue.png",
    "glow",
    "additive",
    0,
  ),

  manifestTexture("sparkle", "Sparkle", "sparkle.png", "spark", "additive", 0),
  manifestTexture(
    "spark-cross",
    "Spark Cross",
    "spark-cross.png",
    "spark",
    "additive",
    0,
  ),
  manifestTexture(
    "spark-dot",
    "Spark Dot",
    "spark-dot.png",
    "spark",
    "additive",
    0,
  ),
  manifestTexture(
    "spark-streak",
    "Spark Streak",
    "spark-streak.png",
    "spark",
    "additive",
    1,
  ),
  manifestTexture(
    "brackeys-spark",
    "Spark",
    "brackeys-spark.png",
    "spark",
    "additive",
    0,
  ),
  manifestTexture(
    "spark-pop-6x5",
    "Spark Pop 6x5",
    "spark-pop-6x5.png",
    "spark",
    "additive",
    0,
    atlas(6, 5, 26),
  ),
  manifestTexture(
    "kenney-ember-spark",
    "Kenney Ember Spark",
    "kenney-ember-spark.png",
    "spark",
    "additive",
    1,
  ),

  manifestTexture(
    "smoke-puff",
    "Smoke Puff",
    "smoke-puff.png",
    "smoke",
    "normal",
    0,
  ),
  manifestTexture(
    "smoke-wisp",
    "Smoke Wisp",
    "smoke-wisp.png",
    "smoke",
    "normal",
    0,
  ),
  manifestTexture(
    "dust-soft",
    "Dust Soft",
    "dust-soft.png",
    "smoke",
    "normal",
    0,
  ),
  manifestTexture(
    "brackeys-smoke",
    "Smoke",
    "brackeys-smoke.png",
    "smoke",
    "normal",
    0,
  ),
  manifestTexture(
    "smoke-8x8",
    "Smoke 8x8",
    "smoke-8x8.png",
    "smoke",
    "normal",
    0,
    atlas(8, 8, 64),
  ),
  manifestTexture(
    "kenney-smoke-wisp",
    "Kenney Smoke Wisp",
    "kenney-smoke-wisp.png",
    "smoke",
    "normal",
    0,
  ),

  manifestTexture(
    "trail-taper",
    "Trail Taper",
    "trail-taper.png",
    "trail",
    "additive",
    1,
  ),
  manifestTexture(
    "slash-arc",
    "Slash Arc",
    "slash-arc.png",
    "trail",
    "additive",
    1,
  ),
  manifestTexture(
    "speed-line",
    "Speed Line",
    "speed-line.png",
    "trail",
    "additive",
    1,
  ),

  manifestTexture("heart", "Heart", "heart.png", "symbol", "additive", 0),
  manifestTexture("star", "Star", "star.png", "symbol", "additive", 0),
  manifestTexture("cloud", "Cloud", "cloud.png", "symbol", "normal", 0),
  manifestTexture(
    "raindrop",
    "Raindrop",
    "raindrop.png",
    "symbol",
    "normal",
    0,
  ),
  manifestTexture(
    "question",
    "Question",
    "question.png",
    "symbol",
    "additive",
    0,
  ),
  manifestTexture(
    "exclamation",
    "Exclamation",
    "exclamation.png",
    "symbol",
    "additive",
    0,
  ),
  manifestTexture("zzz", "Zzz", "zzz.png", "symbol", "additive", 0),
  manifestTexture("star-v2", "Star-v2", "star-v2.png", "symbol", "additive", 0),
  manifestTexture(
    "heart-v2",
    "Heart-v2",
    "heart-v2.png",
    "symbol",
    "additive",
    0,
  ),
  manifestTexture(
    "magic-ring",
    "Magic Ring",
    "magic-ring.png",
    "symbol",
    "additive",
    0,
  ),
  manifestTexture(
    "rune-circle",
    "Rune Circle",
    "rune-circle.png",
    "symbol",
    "additive",
    0,
  ),
  manifestTexture(
    "shock-ring",
    "Shock Ring",
    "shock-ring.png",
    "symbol",
    "additive",
    0,
  ),
];

const RUNTIME_TEXTURES = [
  generatedTexture("heart.png", heartSvg()),
  generatedTexture("star.png", starSvg()),
  generatedTexture("sparkle.png", sparkleSvg()),
  generatedTexture("question.png", questionSvg()),
  generatedTexture("exclamation.png", exclamationSvg()),
  generatedTexture(
    "zzz.png",
    textSvg("Zzz", {
      fontSize: 134,
      y: 164,
      stroke: "#ffffff",
      strokeWidth: 12,
    }),
  ),
  generatedTexture("cloud.png", cloudSvg()),
  generatedTexture("raindrop.png", raindropSvg()),
  generatedTexture("soft-dot.png", softDotSvg()),
  sourceTexture({
    output: "brackeys-spark.png",
    sourceRoot: brackeysAlphaDir,
    source: "spark_04_a.png",
  }),
  sourceTexture({
    output: "brackeys-smoke.png",
    sourceRoot: brackeysAlphaDir,
    source: "smoke_02_a.png",
  }),
  sourceTexture({
    output: "brackeys-flare.png",
    sourceRoot: brackeysAlphaDir,
    source: "flare_01_a.png",
  }),
  sourceTexture({
    output: "glow-soft.png",
    sourceRoot: kenneyTransparentDir,
    source: "light_01.png",
  }),
  sourceTexture({
    output: "glow-sharp.png",
    sourceRoot: kenneyTransparentDir,
    source: "light_02.png",
  }),
  sourceTexture({
    output: "flare-star.png",
    sourceRoot: kenneyTransparentDir,
    source: "flare_01.png",
  }),
  sourceTexture({
    output: "spark-cross.png",
    sourceRoot: kenneyTransparentDir,
    source: "spark_05.png",
  }),
  sourceTexture({
    output: "spark-dot.png",
    sourceRoot: kenneyTransparentDir,
    source: "spark_01.png",
  }),
  sourceTexture({
    output: "spark-streak.png",
    sourceRoot: kenneyTransparentDir,
    source: "trace_01.png",
  }),
  sourceTexture({
    output: "smoke-puff.png",
    sourceRoot: kenneyTransparentDir,
    source: "smoke_01.png",
  }),
  sourceTexture({
    output: "smoke-wisp.png",
    sourceRoot: kenneyTransparentDir,
    source: "smoke_06.png",
  }),
  sourceTexture({
    output: "dust-soft.png",
    sourceRoot: kenneyTransparentDir,
    source: "dirt_01.png",
  }),
  sourceTexture({
    output: "trail-taper.png",
    sourceRoot: kenneyTransparentDir,
    source: "trace_05.png",
  }),
  sourceTexture({
    output: "slash-arc.png",
    sourceRoot: kenneyTransparentDir,
    source: "slash_01.png",
  }),
  sourceTexture({
    output: "speed-line.png",
    sourceRoot: kenneyTransparentDir,
    source: "trace_07.png",
  }),
  sourceTexture({
    output: "magic-ring.png",
    sourceRoot: kenneyTransparentDir,
    source: "magic_01.png",
  }),
  sourceTexture({
    output: "rune-circle.png",
    sourceRoot: kenneyTransparentDir,
    source: "symbol_01.png",
  }),
  sourceTexture({
    output: "shock-ring.png",
    sourceRoot: kenneyTransparentDir,
    source: "circle_05.png",
  }),
  sourceTexture({
    output: "kenney-fire-glow.png",
    sourceRoot: kenneyTransparentDir,
    source: "light_03.png",
  }),
  sourceTexture({
    output: "kenney-flame-core.png",
    sourceRoot: kenneyTransparentDir,
    source: "fire_01.png",
  }),
  sourceTexture({
    output: "kenney-flame-tongue.png",
    sourceRoot: kenneyTransparentDir,
    source: "flame_04.png",
  }),
  sourceTexture({
    output: "kenney-ember-spark.png",
    sourceRoot: kenneyTransparentDir,
    source: "spark_07.png",
  }),
  sourceTexture({
    output: "kenney-smoke-wisp.png",
    sourceRoot: kenneyTransparentDir,
    source: "smoke_06.png",
  }),
  atlasTexture({
    output: "fire-8x8.png",
    sourceRoot: brackeysFlipbookDir,
    source: "fire_01_8x8.tga",
    uTileCount: 8,
    vTileCount: 8,
  }),
  atlasTexture({
    output: "smoke-8x8.png",
    sourceRoot: brackeysFlipbookDir,
    source: "wispy_smoke_01_8x8.tga",
    uTileCount: 8,
    vTileCount: 8,
  }),
  atlasTexture({
    output: "flame-16x4.png",
    sourceRoot: brackeysFlipbookDir,
    source: "flame_01_16x4.tga",
    uTileCount: 16,
    vTileCount: 4,
  }),
  atlasTexture({
    output: "spark-pop-6x5.png",
    sourceRoot: brackeysPredrawnDir,
    source: "star_explosion_6x5.png",
    uTileCount: 6,
    vTileCount: 5,
    tileWidth: 128,
    tileHeight: 128,
  }),
];

await fs.mkdir(textureDir, { recursive: true });

for (const texture of RUNTIME_TEXTURES) {
  await writeRuntimeTexture(texture);
}

await fs.writeFile(path.join(particleVfxDir, "README.md"), readme());
await fs.writeFile(textureManifestPath, textureManifestSource());

function manifestTexture(
  id,
  label,
  fileName,
  role,
  recommendedBlending,
  recommendedRenderMode,
  atlasMetadata,
) {
  return {
    id,
    label,
    fileName,
    role,
    recommendedBlending,
    recommendedRenderMode,
    atlas: atlasMetadata,
  };
}

function atlas(uTileCount, vTileCount, frameCount, blendTiles = false) {
  return {
    uTileCount,
    vTileCount,
    frameCount,
    blendTiles,
    frameOverLife: {
      startFrame: 0,
      endFrame: frameCount - 1,
    },
  };
}

function generatedTexture(output, svg) {
  return { kind: "generated", output, svg };
}

function sourceTexture(options) {
  return {
    kind: "source",
    size: runtimeTextureSize,
    ...options,
  };
}

function atlasTexture(options) {
  return {
    kind: "atlas",
    ...options,
  };
}

async function writeRuntimeTexture(texture) {
  if (texture.kind === "generated") {
    await writeSvgPng(texture.output, texture.svg);
    return;
  }
  if (texture.kind === "atlas") {
    await writeAtlasTexture(texture);
    return;
  }

  const sourcePath = path.join(texture.sourceRoot, texture.source);
  const outputPath = path.join(textureDir, texture.output);

  try {
    await fs.access(sourcePath);
  } catch (error) {
    throw new Error(
      `Particle VFX source texture missing: ${sourcePath}. ` +
        `Add the exact licensed source asset for ${texture.output}.`,
      { cause: error },
    );
  }

  await sharp(sourcePath)
    .ensureAlpha()
    .resize(texture.size, texture.size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPath);
}

async function writeAtlasTexture(texture) {
  const sourcePath = path.join(texture.sourceRoot, texture.source);
  const outputPath = path.join(textureDir, texture.output);

  try {
    await fs.access(sourcePath);
  } catch (error) {
    throw new Error(
      `Particle VFX atlas source missing: ${sourcePath}. ` +
        `Add the source asset for ${texture.output}.`,
      { cause: error },
    );
  }

  const targetWidth =
    typeof texture.tileWidth === "number"
      ? texture.uTileCount * texture.tileWidth
      : null;
  const targetHeight =
    typeof texture.tileHeight === "number"
      ? texture.vTileCount * texture.tileHeight
      : null;

  if (texture.source.toLowerCase().endsWith(".tga")) {
    const tga = await readTgaRgba(sourcePath);
    let image = sharp(tga.data, {
      raw: {
        width: tga.width,
        height: tga.height,
        channels: 4,
      },
    });
    if (targetWidth && targetHeight) {
      image = image.resize(targetWidth, targetHeight, { fit: "fill" });
    }
    await image.png().toFile(outputPath);
    return;
  }

  let image = sharp(sourcePath).ensureAlpha();
  if (targetWidth && targetHeight) {
    image = image.resize(targetWidth, targetHeight, { fit: "fill" });
  }
  await image.png().toFile(outputPath);
}

async function writeSvgPng(fileName, svg) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(textureDir, fileName));
}

async function readTgaRgba(filePath) {
  const input = await fs.readFile(filePath);
  const idLength = input[0];
  const colorMapType = input[1];
  const imageType = input[2];
  const width = input.readUInt16LE(12);
  const height = input.readUInt16LE(14);
  const pixelDepth = input[16];
  const descriptor = input[17];

  if (colorMapType !== 0 || imageType !== 2) {
    throw new Error(
      `Unsupported TGA format for ${filePath}: expected uncompressed truecolor.`,
    );
  }
  if (pixelDepth !== 24 && pixelDepth !== 32) {
    throw new Error(
      `Unsupported TGA bit depth for ${filePath}: expected 24 or 32, got ${pixelDepth}.`,
    );
  }

  const bytesPerPixel = pixelDepth / 8;
  const pixelStart = 18 + idLength;
  const expectedBytes = width * height * bytesPerPixel;
  if (input.length < pixelStart + expectedBytes) {
    throw new Error(`TGA file is truncated: ${filePath}.`);
  }

  const originTop = (descriptor & 0x20) !== 0;
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const targetY = originTop ? y : height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = pixelStart + (y * width + x) * bytesPerPixel;
      const targetOffset = (targetY * width + x) * 4;
      const b = input[sourceOffset];
      const g = input[sourceOffset + 1];
      const r = input[sourceOffset + 2];
      output[targetOffset] = r;
      output[targetOffset + 1] = g;
      output[targetOffset + 2] = b;
      output[targetOffset + 3] =
        bytesPerPixel === 4 ? input[sourceOffset + 3] : Math.max(r, g, b);
    }
  }

  return { data: output, width, height };
}

function textureManifestSource() {
  return `${textureManifestHeader()}${TEXTURE_MANIFEST.map(
    formatManifestTexture,
  ).join(
    "",
  )}] as const satisfies readonly ParticleVFXEditorTextureManifestEntry[];

function texture(
  id: string,
  label: string,
  fileName: string,
  role: ParticleVFXEditorTextureRole,
  recommendedBlending: TextureBlending,
  recommendedRenderMode: TextureRenderMode,
  atlas?: TextureAtlas,
): ParticleVFXEditorTextureManifestEntry {
  return {
    id,
    label,
    fileName,
    role,
    recommendedBlending,
    recommendedRenderMode,
    atlas,
  };
}
`;
}

function textureManifestHeader() {
  return `import type {
  ParticleVFXEditorTextureManifestEntry,
  ParticleVFXEditorTextureRole,
} from "./types";

type TextureBlending =
  ParticleVFXEditorTextureManifestEntry["recommendedBlending"];
type TextureRenderMode =
  ParticleVFXEditorTextureManifestEntry["recommendedRenderMode"];
type TextureAtlas = ParticleVFXEditorTextureManifestEntry["atlas"];

export const PARTICLE_VFX_EDITOR_TEXTURE_ROLE_ORDER = [
  "glow",
  "spark",
  "smoke",
  "trail",
  "symbol",
] as const satisfies readonly ParticleVFXEditorTextureRole[];

export const PARTICLE_VFX_EDITOR_TEXTURE_ROLE_LABELS = {
  glow: "Glow",
  spark: "Spark",
  smoke: "Smoke/Dust",
  trail: "Trail/Streak",
  symbol: "Symbol",
} as const satisfies Record<ParticleVFXEditorTextureRole, string>;

export const PARTICLE_VFX_EDITOR_TEXTURE_MANIFEST = [
`;
}

function formatManifestTexture(entry) {
  const args = [
    JSON.stringify(entry.id),
    JSON.stringify(entry.label),
    JSON.stringify(entry.fileName),
    JSON.stringify(entry.role),
    JSON.stringify(entry.recommendedBlending),
    `${entry.recommendedRenderMode}`,
  ];
  if (entry.atlas) {
    args.push(formatAtlasObject(entry.atlas));
  }
  return `  texture(${args.join(", ")}),\n`;
}

function formatAtlasObject(atlasMetadata) {
  return `{
    uTileCount: ${atlasMetadata.uTileCount},
    vTileCount: ${atlasMetadata.vTileCount},
    frameCount: ${atlasMetadata.frameCount},
    blendTiles: ${atlasMetadata.blendTiles},
    frameOverLife: {
      startFrame: ${atlasMetadata.frameOverLife.startFrame},
      endFrame: ${atlasMetadata.frameOverLife.endFrame},
    },
  }`;
}

function svgWrap(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;
}

function heartSvg() {
  return svgWrap(
    '<path fill="#fff" transform="translate(8 8) scale(10)" d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.53L12 21.35z"/>',
  );
}

function questionSvg() {
  return svgWrap(
    '<path fill="#fff" transform="matrix(13 0 0 13 -28 8)" d="M12.05 2C8.78 2 6.4 3.9 6.18 6.75h2.4c.16-1.54 1.44-2.54 3.4-2.54 2.05 0 3.45 1.14 3.45 2.88 0 1.38-.78 2.18-2.34 3.16-1.9 1.18-2.65 2.3-2.52 4.38h2.32c-.02-1.42.45-2.1 1.96-3.06 1.83-1.16 3.04-2.48 3.04-4.58 0-2.94-2.35-4.99-5.84-4.99z"/><circle fill="#fff" cx="129" cy="226" r="17"/>',
  );
}

function starSvg() {
  return svgWrap(
    '<path fill="#fff" d="m128 20 28 71 76 5-58 49 19 74-65-40-65 40 19-74-58-49 76-5 28-71z"/>',
  );
}

function sparkleSvg() {
  return svgWrap(
    '<path fill="#fff" d="M128 8c11 60 20 80 80 91-60 11-69 31-80 91-11-60-20-80-80-91 60-11 69-31 80-91z"/><path fill="#fff" opacity=".76" d="M53 157c6 32 12 42 44 48-32 6-38 16-44 48-6-32-12-42-44-48 32-6 38-16 44-48z"/><path fill="#fff" opacity=".78" d="M204 20c5 27 10 35 37 40-27 5-32 14-37 40-5-26-10-35-37-40 27-5 32-13 37-40z"/>',
  );
}

function exclamationSvg() {
  return svgWrap(
    '<path fill="#fff" d="M105 22h62l-14 142h-34L105 22z"/><circle fill="#fff" cx="136" cy="211" r="29"/>',
  );
}

function cloudSvg() {
  return svgWrap(
    '<path fill="#fff" d="M72 173c-26 0-47-19-47-43 0-22 18-41 42-43 9-26 34-45 64-45 33 0 60 22 66 51 22 6 34 22 34 41 0 23-20 39-45 39H72z"/>',
  );
}

function raindropSvg() {
  return svgWrap(
    '<path fill="#fff" d="M128 24c38 52 63 92 63 132 0 39-27 68-63 68s-63-29-63-68c0-40 25-80 63-132z"/>',
  );
}

function softDotSvg() {
  return svgWrap(
    '<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".55" stop-color="#fff" stop-opacity=".62"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="128" cy="128" r="118" fill="url(#g)"/>',
  );
}

function textSvg(text, options) {
  return svgWrap(
    `<text x="128" y="${options.y}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${options.fontSize}" font-weight="900" fill="#fff" stroke="${options.stroke}" stroke-width="${options.strokeWidth}" paint-order="stroke" dominant-baseline="middle">${text}</text>`,
  );
}

function readme() {
  return `# Particle VFX Curated Assets

This folder contains the curated texture set the Particle Effect creator offers
as built-in textures (its texture picker, emitter templates and default
texture).

Generated by:

\`\`\`bash
pnpm generate:particle-vfx-assets --output-dir /tmp/particle-review --kenney-root /path/to/kenney-pack --brackeys-root /path/to/brackeys_vfx_bundle
\`\`\`

Sources:

- Generated icons: simple white-alpha bitmap symbols created by Animama's
  generator script.
- Kenney Particle Pack derivatives: selected transparent PNG particle masks
  from \`kenney_particle-pack/PNG (Transparent)\`, resized to normalized
  256x256 PNG runtime assets.
- Brackeys VFX bundle derivatives: selected alpha particle masks from
  \`brackeys_vfx_bundle/particles/alpha\`, resized to normalized 256x256 PNG
  runtime assets; selected predrawn PNG atlases from
  \`brackeys_vfx_bundle/predrawn\`; and selected TGA flipbooks from
  \`brackeys_vfx_bundle/flipbooks\`, decoded and normalized into PNG atlases.
  The Brackeys bundle license file declares the pack CC0.

Outputs are staged separately; review before copying them to Included content.
Source archive hashes, exact output mappings, and notices are in
\`licenses/third-party/art-particles.json\` and \`licenses/third-party/art-NOTICES.md\`.
The raw downloaded packs remain ignored and are not referenced by the runtime
catalog. A Particle Effect carries its own copy of each texture it uses, beside
its manifest in \`textures/\`. The editor-facing texture manifest
lives in
\`src/frontend/web/src/lib/avatar/particle-vfx/editor/textureManifest.ts\` and
records the catalog id, role, recommended blending, and recommended render mode
for each picker texture. Atlas entries also record tile counts, frame counts,
blend-tile defaults, and recommended \`FrameOverLife\` frame ranges.
`;
}
