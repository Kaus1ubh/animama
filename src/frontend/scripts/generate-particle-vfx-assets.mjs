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
  if (!["--output-dir", "--kenney-root", "--brackeys-root"].includes(name) ||
      !args[index + 1] || options.has(name)) {
    throw new Error("Use --output-dir DIR --kenney-root DIR --brackeys-root DIR");
  }
  options.set(name, path.resolve(args[index + 1]));
}
for (const required of ["--output-dir", "--kenney-root", "--brackeys-root"]) {
  if (!options.has(required)) throw new Error(`Missing ${required}`);
}
const particleVfxDir = options.get("--output-dir");
const repositoryRoot = path.resolve(workspaceRoot, "../..");
const includedRoot = path.join(repositoryRoot, "content/included");
if (particleVfxDir === includedRoot || particleVfxDir.startsWith(`${includedRoot}${path.sep}`)) {
  throw new Error("Choose a staging directory outside content/included; review outputs before copying.");
}
// Refuse an existing destination to preserve prior results and unrelated files.
await fs.mkdir(particleVfxDir, { recursive: false });
const textureDir = path.join(particleVfxDir, "textures");
const quarkDir = path.join(particleVfxDir, "quark");
const textureManifestPath = path.join(particleVfxDir, "textureManifest.ts");
const kenneyTransparentDir = path.join(options.get("--kenney-root"), "PNG (Transparent)");
const brackeysAlphaDir = path.join(options.get("--brackeys-root"), "particles/alpha");
const brackeysFlipbookDir = path.join(options.get("--brackeys-root"), "flipbooks");
const brackeysPredrawnDir = path.join(options.get("--brackeys-root"), "predrawn");
const quarkRelativeTextureRoot = "../particle-vfx/textures";
const runtimeTextureSize = 256;

const BLENDING = {
  normal: 1,
  additive: 2,
};

const TEXTURE_MANIFEST = [
  manifestTexture("soft-dot", "Soft Dot", "soft-dot.png", "glow", "additive", 0),
  manifestTexture("glow-soft", "Glow Soft", "glow-soft.png", "glow", "additive", 0),
  manifestTexture("glow-sharp", "Glow Sharp", "glow-sharp.png", "glow", "additive", 0),
  manifestTexture("flare-star", "Flare Star", "flare-star.png", "glow", "additive", 0),
  manifestTexture(
    "brackeys-flare",
    "Flare",
    "brackeys-flare.png",
    "glow",
    "additive",
    0,
  ),
  manifestTexture("fire-8x8", "Fire 8x8", "fire-8x8.png", "glow", "additive", 0, atlas(8, 8, 64)),
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
  manifestTexture("spark-cross", "Spark Cross", "spark-cross.png", "spark", "additive", 0),
  manifestTexture("spark-dot", "Spark Dot", "spark-dot.png", "spark", "additive", 0),
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

  manifestTexture("smoke-puff", "Smoke Puff", "smoke-puff.png", "smoke", "normal", 0),
  manifestTexture("smoke-wisp", "Smoke Wisp", "smoke-wisp.png", "smoke", "normal", 0),
  manifestTexture("dust-soft", "Dust Soft", "dust-soft.png", "smoke", "normal", 0),
  manifestTexture(
    "brackeys-smoke",
    "Smoke",
    "brackeys-smoke.png",
    "smoke",
    "normal",
    0,
  ),
  manifestTexture("smoke-8x8", "Smoke 8x8", "smoke-8x8.png", "smoke", "normal", 0, atlas(8, 8, 64)),
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
  manifestTexture("slash-arc", "Slash Arc", "slash-arc.png", "trail", "additive", 1),
  manifestTexture("speed-line", "Speed Line", "speed-line.png", "trail", "additive", 1),

  manifestTexture("heart", "Heart", "heart.png", "symbol", "additive", 0),
  manifestTexture("star", "Star", "star.png", "symbol", "additive", 0),
  manifestTexture("cloud", "Cloud", "cloud.png", "symbol", "normal", 0),
  manifestTexture("raindrop", "Raindrop", "raindrop.png", "symbol", "normal", 0),
  manifestTexture("question", "Question", "question.png", "symbol", "additive", 0),
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
  manifestTexture("heart-v2", "Heart-v2", "heart-v2.png", "symbol", "additive", 0),
  manifestTexture("magic-ring", "Magic Ring", "magic-ring.png", "symbol", "additive", 0),
  manifestTexture("rune-circle", "Rune Circle", "rune-circle.png", "symbol", "additive", 0),
  manifestTexture("shock-ring", "Shock Ring", "shock-ring.png", "symbol", "additive", 0),
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

const EFFECTS = [
  {
    id: "hearts",
    label: "Hearts",
    duration: 1.8,
    emitters: [
      emitter("hearts", {
        texture: "heart.png",
        duration: 0.35,
        startLife: [1.15, 1.55],
        startSize: [0.15, 0.24],
        startSpeed: [0.05, 0.12],
        burstCount: 8,
        shape: sphereShape(0.12),
        color: gradient(
          [
            [rgb(1, 0.42, 0.64), 0],
            [rgb(1, 0.76, 0.84), 0.7],
            [rgb(1, 0.9, 0.94), 1],
          ],
          [
            [0, 0],
            [1, 0.08],
            [1, 0.72],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.4, 1, 0.9, 0),
        force: { x: 0, y: 0.16, z: 0 },
        rotation: [-1.2, 1.2],
      }),
    ],
  },
  {
    id: "stars",
    label: "Stars",
    duration: 1.4,
    emitters: [
      emitter("stars", {
        texture: "star.png",
        duration: 0.2,
        startLife: [0.65, 0.95],
        startSize: [0.11, 0.19],
        startSpeed: [0.18, 0.32],
        burstCount: 10,
        shape: sphereShape(0.03),
        color: gradient(
          [
            [rgb(1, 0.92, 0.32), 0],
            [rgb(1, 0.72, 0.16), 1],
          ],
          [
            [1, 0],
            [1, 0.55],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.15, 1.15, 0.85, 0),
        force: { x: 0, y: 0.03, z: 0 },
        rotation: [-3, 3],
      }),
    ],
  },
  {
    id: "sparkles",
    label: "Sparkles",
    duration: 1.6,
    emitters: [
      emitter("sparkles-core", {
        texture: "sparkle.png",
        duration: 0.25,
        startLife: [0.75, 1.15],
        startSize: [0.06, 0.13],
        startSpeed: [0.12, 0.24],
        burstCount: 12,
        shape: sphereShape(0.16),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.65, 0.92, 1), 1],
          ],
          [
            [0, 0],
            [1, 0.12],
            [1, 0.62],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.05, 1, 0.7, 0),
        force: { x: 0, y: 0.04, z: 0 },
        rotation: [-2.5, 2.5],
      }),
      emitter("sparkles-flare", {
        texture: "brackeys-flare.png",
        duration: 0.1,
        startLife: 0.45,
        startSize: [0.12, 0.2],
        startSpeed: 0,
        burstCount: 3,
        shape: sphereShape(0.08),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.6, 0.85, 1), 1],
          ],
          [
            [0.9, 0],
            [0.8, 0.25],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.1, 1, 0.5, 0),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-1.5, 1.5],
      }),
    ],
  },
  {
    id: "question-marks",
    label: "Question Marks",
    duration: 2,
    emitters: [
      emitter("question-marks", {
        texture: "question.png",
        duration: 0.8,
        emissionOverTime: 2.5,
        startLife: [1.25, 1.75],
        startSize: [0.18, 0.26],
        startSpeed: [0.02, 0.07],
        burstCount: 1,
        shape: sphereShape(0.08),
        color: gradient(
          [
            [rgb(0.46, 0.74, 1), 0],
            [rgb(0.72, 0.9, 1), 1],
          ],
          [
            [0, 0],
            [1, 0.12],
            [1, 0.7],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.2, 1, 0.9, 0),
        force: { x: 0, y: 0.1, z: 0 },
        rotation: [-0.6, 0.6],
      }),
    ],
  },
  {
    id: "exclamation",
    label: "Exclamation",
    duration: 1.2,
    emitters: [
      emitter("exclamation-mark", {
        texture: "exclamation.png",
        duration: 0.05,
        startLife: 0.85,
        startSize: [0.24, 0.32],
        startSpeed: 0.03,
        burstCount: 1,
        shape: pointShape(),
        color: gradient(
          [
            [rgb(1, 0.2, 0.12), 0],
            [rgb(1, 0.72, 0.34), 1],
          ],
          [
            [1, 0],
            [1, 0.64],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.2, 1.18, 0.95, 0),
        force: { x: 0, y: 0.03, z: 0 },
        rotation: [-0.18, 0.18],
      }),
      emitter("exclamation-pop", {
        texture: "brackeys-flare.png",
        duration: 0.05,
        startLife: 0.4,
        startSize: [0.18, 0.26],
        startSpeed: [0.04, 0.12],
        burstCount: 4,
        shape: sphereShape(0.04),
        color: gradient(
          [
            [rgb(1, 0.86, 0.42), 0],
            [rgb(1, 0.32, 0.16), 1],
          ],
          [
            [0.9, 0],
            [0.65, 0.35],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.2, 1, 0.45, 0),
        force: { x: 0, y: 0, z: 0 },
        rotation: [-2, 2],
      }),
    ],
  },
  {
    id: "zzz",
    label: "Zzz",
    duration: 2.5,
    emitters: [
      emitter("zzz", {
        texture: "zzz.png",
        duration: 1.2,
        emissionOverTime: 2.2,
        startLife: [1.2, 1.8],
        startSize: [0.17, 0.24],
        startSpeed: [0.02, 0.06],
        burstCount: 1,
        shape: sphereShape(0.05),
        position: [0.08, 0.03, 0],
        color: gradient(
          [
            [rgb(0.56, 0.7, 1), 0],
            [rgb(0.8, 0.9, 1), 1],
          ],
          [
            [0, 0],
            [0.85, 0.12],
            [0.8, 0.65],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.15, 1, 0.9, 0),
        force: { x: 0.035, y: 0.08, z: 0 },
        rotation: [-0.2, 0.2],
      }),
    ],
  },
  {
    id: "rain-cloud",
    label: "Rain Cloud",
    duration: 2.4,
    emitters: [
      emitter("rain-cloud-puff", {
        texture: "cloud.png",
        duration: 0.1,
        startLife: 2.1,
        startSize: [0.3, 0.4],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        position: [0, 0.08, 0],
        color: gradient(
          [
            [rgb(0.62, 0.68, 0.76), 0],
            [rgb(0.42, 0.5, 0.62), 1],
          ],
          [
            [0, 0],
            [0.8, 0.12],
            [0.65, 0.75],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.4, 1, 0.9, 0.75),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-0.08, 0.08],
        blending: "normal",
      }),
      emitter("rain-drops", {
        texture: "raindrop.png",
        duration: 1.45,
        emissionOverTime: 8,
        startLife: [0.65, 0.95],
        startSize: [0.055, 0.085],
        startSpeed: [0.01, 0.04],
        burstCount: 3,
        shape: sphereShape(0.13),
        position: [0, -0.06, 0],
        color: gradient(
          [
            [rgb(0.42, 0.76, 1), 0],
            [rgb(0.7, 0.9, 1), 1],
          ],
          [
            [0.9, 0],
            [0.8, 0.45],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.6, 1, 0.75, 0),
        force: { x: 0, y: -0.2, z: 0 },
        rotation: [-0.08, 0.08],
        blending: "normal",
      }),
    ],
  },
  {
    id: "flame-loop",
    label: "Flame Loop",
    duration: 1.4,
    emitters: [
      emitter("flame-base-glow", {
        texture: "kenney-fire-glow.png",
        looping: true,
        prewarm: true,
        duration: 1.4,
        emissionOverTime: 1.5,
        startLife: [0.8, 1.25],
        startSize: [0.42, 0.62],
        startSpeed: [0, 0.025],
        burstCount: 1,
        shape: sphereShape(0.06),
        position: [0, -0.08, 0],
        color: gradient(
          [
            [rgb(1, 0.58, 0.16), 0],
            [rgb(1, 0.22, 0.08), 1],
          ],
          [
            [0, 0],
            [0.65, 0.18],
            [0.45, 0.68],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.55, 1, 0.85, 0.25),
        force: { x: 0, y: 0.035, z: 0 },
        rotation: [-0.35, 0.35],
        renderOrder: 16,
      }),
      emitter("flame-inner-core", {
        texture: "kenney-flame-core.png",
        looping: true,
        prewarm: true,
        duration: 1.05,
        emissionOverTime: 18,
        startLife: [0.45, 0.72],
        startSize: [0.14, 0.24],
        startSpeed: [0.16, 0.32],
        burstCount: 0,
        shape: coneShape(0.08, 0.4),
        position: [0, -0.08, 0],
        color: gradient(
          [
            [rgb(1, 0.95, 0.58), 0],
            [rgb(1, 0.52, 0.14), 0.72],
            [rgb(1, 0.28, 0.08), 1],
          ],
          [
            [0, 0],
            [1, 0.1],
            [0.78, 0.58],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.25, 1.05, 0.7, 0),
        force: { x: 0, y: 0.24, z: 0 },
        rotation: [-2.6, 2.6],
        renderOrder: 22,
      }),
      emitter("flame-outer-tongues", {
        texture: "kenney-flame-tongue.png",
        looping: true,
        prewarm: true,
        duration: 1.2,
        emissionOverTime: 12,
        startLife: [0.55, 0.9],
        startSize: [0.2, 0.34],
        startSpeed: [0.1, 0.22],
        burstCount: 0,
        shape: coneShape(0.13, 0.55),
        position: [0, -0.1, 0],
        color: gradient(
          [
            [rgb(1, 0.64, 0.18), 0],
            [rgb(1, 0.28, 0.08), 0.62],
            [rgb(0.72, 0.05, 0.02), 1],
          ],
          [
            [0, 0],
            [0.86, 0.12],
            [0.55, 0.66],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.22, 1.1, 0.8, 0),
        force: { x: 0, y: 0.18, z: 0 },
        rotation: [-3.2, 3.2],
        renderOrder: 21,
      }),
      emitter("flame-embers", {
        texture: "kenney-ember-spark.png",
        looping: true,
        prewarm: true,
        duration: 1.15,
        emissionOverTime: 8,
        startLife: [0.45, 0.9],
        startSize: [0.025, 0.055],
        startSpeed: [0.28, 0.55],
        burstCount: 0,
        shape: coneShape(0.16, 0.62),
        position: [0, 0.02, 0],
        color: gradient(
          [
            [rgb(1, 0.85, 0.28), 0],
            [rgb(1, 0.34, 0.08), 1],
          ],
          [
            [0, 0],
            [1, 0.08],
            [0.88, 0.58],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.35, 1, 0.65, 0),
        force: { x: 0, y: 0.35, z: 0 },
        rotation: [-5, 5],
        renderMode: 1,
        rendererEmitterSettings: {
          speedFactor: 0.02,
          lengthFactor: 1.75,
        },
        renderOrder: 24,
      }),
      emitter("flame-smoke-wisps", {
        texture: "kenney-smoke-wisp.png",
        looping: true,
        prewarm: true,
        duration: 1.8,
        emissionOverTime: 2.2,
        startLife: [1.15, 1.8],
        startSize: [0.16, 0.34],
        startSpeed: [0.05, 0.13],
        burstCount: 0,
        shape: coneShape(0.16, 0.45),
        position: [0, 0.16, -0.01],
        color: gradient(
          [
            [rgb(0.58, 0.54, 0.5), 0],
            [rgb(0.42, 0.38, 0.34), 1],
          ],
          [
            [0, 0],
            [0.28, 0.18],
            [0.18, 0.62],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.35, 0.85, 1.1, 0),
        force: { x: 0, y: 0.1, z: 0 },
        rotation: [-0.7, 0.7],
        blending: "normal",
        renderOrder: 18,
      }),
    ],
  },
  {
    id: "magic-sparkle-burst",
    label: "Magic Sparkle Burst",
    duration: 1.8,
    emitters: [
      emitter("magic-sparkle-flipbook", {
        texture: "spark-pop-6x5.png",
        duration: 0.05,
        startLife: 0.72,
        startSize: [0.38, 0.52],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.62, 0.88, 1), 0.55],
            [rgb(0.82, 0.62, 1), 1],
          ],
          [
            [0, 0],
            [0.94, 0.08],
            [0.72, 0.58],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.08, 1.15, 0.85, 0),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-0.2, 0.2],
        uTileCount: 6,
        vTileCount: 5,
        frameOverLife: { startFrame: 0, endFrame: 25 },
        renderOrder: 32,
      }),
      emitter("magic-sparkle-ring", {
        texture: "magic-ring.png",
        duration: 0.05,
        startLife: 0.8,
        startSize: [0.44, 0.58],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        color: gradient(
          [
            [rgb(0.7, 0.92, 1), 0],
            [rgb(0.95, 0.72, 1), 1],
          ],
          [
            [0, 0],
            [0.78, 0.12],
            [0.52, 0.62],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.05, 1.08, 1.12, 0),
        force: { x: 0, y: 0, z: 0 },
        rotation: [-0.45, 0.45],
        renderOrder: 27,
      }),
      emitter("magic-sparkle-flares", {
        texture: "brackeys-flare.png",
        duration: 0.08,
        startLife: [0.36, 0.7],
        startSize: [0.12, 0.23],
        startSpeed: [0.04, 0.12],
        burstCount: 5,
        shape: sphereShape(0.12),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.6, 0.9, 1), 1],
          ],
          [
            [0.95, 0],
            [0.74, 0.28],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.08, 1, 0.45, 0),
        force: { x: 0, y: 0.04, z: 0 },
        rotation: [-2.2, 2.2],
        renderOrder: 31,
      }),
      emitter("magic-sparkle-streaks", {
        texture: "spark-streak.png",
        duration: 0.12,
        startLife: [0.36, 0.68],
        startSize: [0.036, 0.07],
        startSpeed: [0.32, 0.58],
        burstCount: 14,
        shape: sphereShape(0.04),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.55, 0.8, 1), 0.62],
            [rgb(0.92, 0.55, 1), 1],
          ],
          [
            [0, 0],
            [0.95, 0.08],
            [0.68, 0.52],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.3, 1, 0.6, 0),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-4.2, 4.2],
        renderMode: 1,
        rendererEmitterSettings: {
          speedFactor: 0.035,
          lengthFactor: 1.9,
        },
        renderOrder: 33,
      }),
      emitter("magic-sparkle-dust", {
        texture: "sparkle.png",
        duration: 0.26,
        startLife: [0.76, 1.26],
        startSize: [0.045, 0.09],
        startSpeed: [0.08, 0.2],
        burstCount: 18,
        shape: sphereShape(0.2),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.68, 0.9, 1), 0.7],
            [rgb(0.88, 0.74, 1), 1],
          ],
          [
            [0, 0],
            [0.9, 0.14],
            [0.7, 0.62],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.04, 1, 0.72, 0),
        force: { x: 0, y: 0.08, z: 0 },
        rotation: [-3.4, 3.4],
        behaviors: [
          noiseBehavior({
            frequency: 1.8,
            power: 0.04,
            positionAmount: 0.75,
            rotationAmount: 0.1,
          }),
        ],
        renderOrder: 34,
      }),
    ],
  },
  {
    id: "soft-heart-pop",
    label: "Soft Heart Pop",
    duration: 1.9,
    emitters: [
      emitter("soft-heart-glow", {
        texture: "glow-soft.png",
        duration: 0.05,
        startLife: 1.1,
        startSize: [0.38, 0.5],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        color: gradient(
          [
            [rgb(1, 0.62, 0.82), 0],
            [rgb(1, 0.84, 0.92), 1],
          ],
          [
            [0, 0],
            [0.56, 0.16],
            [0.38, 0.62],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.25, 1, 0.9, 0),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-0.2, 0.2],
        renderOrder: 18,
      }),
      emitter("soft-heart-primary", {
        texture: "heart-v2.png",
        duration: 0.22,
        startLife: [0.95, 1.38],
        startSize: [0.13, 0.23],
        startSpeed: [0.08, 0.18],
        burstCount: 6,
        shape: sphereShape(0.12),
        position: [0, 0.02, 0],
        color: gradient(
          [
            [rgb(1, 0.42, 0.64), 0],
            [rgb(1, 0.78, 0.88), 1],
          ],
          [
            [0, 0],
            [0.95, 0.08],
            [0.78, 0.68],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.2, 1.08, 0.82, 0),
        force: { x: 0, y: 0.13, z: 0 },
        rotation: [-1.1, 1.1],
        renderOrder: 24,
      }),
      emitter("soft-heart-classic", {
        texture: "heart.png",
        duration: 0.28,
        startLife: [0.82, 1.22],
        startSize: [0.08, 0.16],
        startSpeed: [0.1, 0.22],
        burstCount: 8,
        shape: sphereShape(0.18),
        color: gradient(
          [
            [rgb(1, 0.58, 0.72), 0],
            [rgb(1, 0.92, 0.96), 1],
          ],
          [
            [0, 0],
            [0.88, 0.12],
            [0.7, 0.66],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.16, 1, 0.82, 0),
        force: { x: 0, y: 0.16, z: 0 },
        rotation: [-1.8, 1.8],
        renderOrder: 25,
      }),
      emitter("soft-heart-spark-dots", {
        texture: "spark-dot.png",
        duration: 0.32,
        startLife: [0.62, 1.05],
        startSize: [0.025, 0.052],
        startSpeed: [0.12, 0.26],
        burstCount: 14,
        shape: sphereShape(0.2),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(1, 0.66, 0.82), 1],
          ],
          [
            [0, 0],
            [0.86, 0.1],
            [0.58, 0.58],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.1, 1, 0.58, 0),
        force: { x: 0, y: 0.1, z: 0 },
        rotation: [-3.2, 3.2],
        renderOrder: 27,
      }),
    ],
  },
  {
    id: "surprise-shock-pop",
    label: "Surprise Shock Pop",
    duration: 1.25,
    emitters: [
      emitter("surprise-shock-ring", {
        texture: "shock-ring.png",
        duration: 0.04,
        startLife: 0.58,
        startSize: [0.42, 0.54],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        color: gradient(
          [
            [rgb(1, 0.92, 0.32), 0],
            [rgb(1, 0.38, 0.12), 1],
          ],
          [
            [0, 0],
            [0.92, 0.08],
            [0.5, 0.55],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.08, 1.14, 1.08, 0),
        force: { x: 0, y: 0.01, z: 0 },
        rotation: [-0.18, 0.18],
        renderOrder: 29,
      }),
      emitter("surprise-exclamation-mark", {
        texture: "exclamation.png",
        duration: 0.05,
        startLife: 0.88,
        startSize: [0.28, 0.36],
        startSpeed: 0.02,
        burstCount: 1,
        shape: pointShape(),
        position: [0, 0.05, 0],
        color: gradient(
          [
            [rgb(1, 0.96, 0.42), 0],
            [rgb(1, 0.34, 0.12), 1],
          ],
          [
            [0, 0],
            [1, 0.1],
            [0.78, 0.68],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.22, 1.2, 0.95, 0),
        force: { x: 0, y: 0.04, z: 0 },
        rotation: [-0.16, 0.16],
        renderOrder: 34,
      }),
      emitter("surprise-flare-pop", {
        texture: "brackeys-flare.png",
        duration: 0.06,
        startLife: [0.28, 0.45],
        startSize: [0.16, 0.28],
        startSpeed: [0.04, 0.14],
        burstCount: 4,
        shape: sphereShape(0.05),
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(1, 0.72, 0.22), 1],
          ],
          [
            [0.95, 0],
            [0.7, 0.3],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.12, 1, 0.45, 0),
        force: { x: 0, y: 0, z: 0 },
        rotation: [-2.6, 2.6],
        renderOrder: 32,
      }),
      emitter("surprise-spark-streaks", {
        texture: "spark-streak.png",
        duration: 0.1,
        startLife: [0.28, 0.52],
        startSize: [0.032, 0.06],
        startSpeed: [0.38, 0.72],
        burstCount: 14,
        shape: sphereShape(0.035),
        color: gradient(
          [
            [rgb(1, 0.98, 0.7), 0],
            [rgb(1, 0.36, 0.14), 1],
          ],
          [
            [0, 0],
            [0.9, 0.08],
            [0.56, 0.48],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.3, 1, 0.5, 0),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-4.8, 4.8],
        renderMode: 1,
        rendererEmitterSettings: {
          speedFactor: 0.04,
          lengthFactor: 2.1,
        },
        renderOrder: 35,
      }),
    ],
  },
  {
    id: "confusion-orbit-marks",
    label: "Confusion Orbit Marks",
    duration: 2.3,
    emitters: [
      emitter("confusion-questions", {
        texture: "question.png",
        duration: 0.62,
        emissionOverTime: 2.4,
        startLife: [1.32, 1.78],
        startSize: [0.14, 0.22],
        startSpeed: [0.03, 0.09],
        burstCount: 2,
        shape: sphereShape(0.14),
        position: [0.02, 0.02, 0],
        color: gradient(
          [
            [rgb(0.42, 0.72, 1), 0],
            [rgb(0.78, 0.92, 1), 1],
          ],
          [
            [0, 0],
            [0.92, 0.14],
            [0.74, 0.68],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.18, 1, 0.88, 0),
        force: { x: 0, y: 0.08, z: 0 },
        rotation: [-0.7, 0.7],
        behaviors: [orbitOverLife(0.85, [0, 1, 0])],
        renderOrder: 28,
      }),
      emitter("confusion-orbit-dots", {
        texture: "spark-dot.png",
        duration: 1.35,
        emissionOverTime: 7.2,
        startLife: [1, 1.46],
        startSize: [0.026, 0.052],
        startSpeed: [0.05, 0.12],
        burstCount: 6,
        shape: sphereShape(0.24),
        color: gradient(
          [
            [rgb(0.68, 0.94, 1), 0],
            [rgb(0.48, 0.68, 1), 1],
          ],
          [
            [0, 0],
            [0.84, 0.12],
            [0.62, 0.64],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.12, 1, 0.74, 0),
        force: { x: 0, y: 0.04, z: 0 },
        rotation: [-2.5, 2.5],
        behaviors: [
          orbitOverLife([1.25, 2.05], [0, 1, 0]),
          noiseBehavior({
            frequency: 1.2,
            power: 0.025,
            positionAmount: 0.55,
            rotationAmount: 0,
          }),
        ],
        renderOrder: 25,
      }),
      emitter("confusion-soft-glow", {
        texture: "glow-soft.png",
        duration: 0.08,
        startLife: 2.05,
        startSize: [0.28, 0.38],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        color: gradient(
          [
            [rgb(0.32, 0.62, 1), 0],
            [rgb(0.72, 0.9, 1), 1],
          ],
          [
            [0, 0],
            [0.34, 0.18],
            [0.2, 0.7],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.6, 1, 0.86, 0),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-0.2, 0.2],
        renderOrder: 18,
      }),
    ],
  },
  {
    id: "sleep-bubbles",
    label: "Sleep Bubbles",
    duration: 2.8,
    emitters: [
      emitter("sleep-soft-bubbles", {
        texture: "soft-dot.png",
        duration: 1.55,
        emissionOverTime: 4.2,
        startLife: [1.16, 1.78],
        startSize: [0.08, 0.16],
        startSpeed: [0.025, 0.075],
        burstCount: 3,
        shape: sphereShape(0.08),
        position: [0.08, 0, 0],
        color: gradient(
          [
            [rgb(0.7, 0.86, 1), 0],
            [rgb(0.95, 0.98, 1), 1],
          ],
          [
            [0, 0],
            [0.46, 0.18],
            [0.28, 0.72],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.25, 1, 1.12, 0),
        force: { x: 0.035, y: 0.12, z: 0 },
        rotation: [-0.2, 0.2],
        behaviors: [limitSpeedOverLife(0.09, 0.45)],
        renderOrder: 20,
      }),
      emitter("sleep-drifting-zs", {
        texture: "zzz.png",
        duration: 1.25,
        emissionOverTime: 1.35,
        startLife: [1.48, 2.1],
        startSize: [0.15, 0.24],
        startSpeed: [0.015, 0.055],
        burstCount: 1,
        shape: sphereShape(0.05),
        position: [0.12, 0.04, 0],
        color: gradient(
          [
            [rgb(0.58, 0.72, 1), 0],
            [rgb(0.88, 0.94, 1), 1],
          ],
          [
            [0, 0],
            [0.84, 0.16],
            [0.7, 0.7],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.18, 1, 0.9, 0),
        force: { x: 0.05, y: 0.1, z: 0 },
        rotation: [-0.18, 0.18],
        renderOrder: 28,
      }),
      emitter("sleep-bubble-glints", {
        texture: "spark-dot.png",
        duration: 0.82,
        emissionOverTime: 3.4,
        startLife: [0.5, 0.86],
        startSize: [0.02, 0.045],
        startSpeed: [0.04, 0.12],
        burstCount: 4,
        shape: sphereShape(0.16),
        position: [0.06, 0.04, 0],
        color: gradient(
          [
            [rgb(1, 1, 1), 0],
            [rgb(0.76, 0.9, 1), 1],
          ],
          [
            [0, 0],
            [0.86, 0.1],
            [0.56, 0.52],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.08, 1, 0.6, 0),
        force: { x: 0.02, y: 0.08, z: 0 },
        rotation: [-2.4, 2.4],
        renderOrder: 30,
      }),
    ],
  },
  {
    id: "sad-rain-puff",
    label: "Sad Rain Puff",
    duration: 2.5,
    emitters: [
      emitter("sad-rain-cloud", {
        texture: "cloud.png",
        duration: 0.08,
        startLife: 2.18,
        startSize: [0.32, 0.44],
        startSpeed: 0,
        burstCount: 1,
        shape: pointShape(),
        position: [0, 0.08, 0],
        color: gradient(
          [
            [rgb(0.62, 0.68, 0.76), 0],
            [rgb(0.42, 0.5, 0.62), 1],
          ],
          [
            [0, 0],
            [0.72, 0.12],
            [0.58, 0.76],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.42, 1, 0.9, 0.74),
        force: { x: 0, y: 0.02, z: 0 },
        rotation: [-0.06, 0.06],
        blending: "normal",
        renderOrder: 22,
      }),
      emitter("sad-rain-drops", {
        texture: "raindrop.png",
        duration: 1.6,
        emissionOverTime: 9.5,
        startLife: [0.58, 0.86],
        startSize: [0.045, 0.072],
        startSpeed: [0.01, 0.04],
        burstCount: 4,
        shape: sphereShape(0.12),
        position: [0, -0.05, 0],
        color: gradient(
          [
            [rgb(0.42, 0.66, 0.95), 0],
            [rgb(0.72, 0.86, 1), 1],
          ],
          [
            [0.82, 0],
            [0.75, 0.5],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.7, 1, 0.72, 0),
        force: { x: 0, y: -0.24, z: 0 },
        rotation: [-0.08, 0.08],
        blending: "normal",
        renderOrder: 26,
      }),
      emitter("sad-rain-smoke-puff", {
        texture: "smoke-puff.png",
        duration: 0.48,
        emissionOverTime: 3.2,
        startLife: [1, 1.5],
        startSize: [0.14, 0.27],
        startSpeed: [0.02, 0.06],
        burstCount: 3,
        shape: sphereShape(0.16),
        position: [0, 0.02, -0.01],
        color: gradient(
          [
            [rgb(0.58, 0.62, 0.68), 0],
            [rgb(0.42, 0.48, 0.56), 1],
          ],
          [
            [0, 0],
            [0.28, 0.2],
            [0.18, 0.68],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.35, 0.92, 1.12, 0),
        force: { x: 0, y: 0.06, z: 0 },
        rotation: [-0.7, 0.7],
        blending: "normal",
        renderOrder: 18,
      }),
      emitter("sad-rain-dust-soft", {
        texture: "dust-soft.png",
        duration: 0.4,
        startLife: [0.78, 1.08],
        startSize: [0.08, 0.16],
        startSpeed: [0.04, 0.1],
        burstCount: 5,
        shape: sphereShape(0.18),
        position: [0, -0.02, -0.02],
        color: gradient(
          [
            [rgb(0.56, 0.58, 0.64), 0],
            [rgb(0.38, 0.42, 0.5), 1],
          ],
          [
            [0, 0],
            [0.22, 0.18],
            [0.14, 0.62],
            [0, 1],
          ],
        ),
        sizeOverLife: curve(0.3, 0.9, 1, 0),
        force: { x: 0, y: 0.03, z: 0 },
        rotation: [-0.55, 0.55],
        blending: "normal",
        renderOrder: 17,
      }),
    ],
  },
];

await fs.mkdir(textureDir, { recursive: true });
await fs.mkdir(quarkDir, { recursive: true });

for (const texture of RUNTIME_TEXTURES) {
  await writeRuntimeTexture(texture);
}

for (const effect of EFFECTS) {
  await fs.writeFile(
    path.join(quarkDir, `${effect.id}.json`),
    `${stringifyJson(createQuarksJson(effect))}\n`,
  );
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
  ).join("")}] as const satisfies readonly ParticleVFXEditorTextureManifestEntry[];

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

function stringifyJson(value, indent = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isJsonPrimitive)) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    const nextIndent = indent + 2;
    return [
      "[",
      value
        .map(
          (item) =>
            `${" ".repeat(nextIndent)}${stringifyJson(item, nextIndent)}`,
        )
        .join(",\n"),
      `${" ".repeat(indent)}]`,
    ].join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const nextIndent = indent + 2;
    return [
      "{",
      entries
        .map(
          ([key, item]) =>
            `${" ".repeat(nextIndent)}${JSON.stringify(key)}: ${stringifyJson(
              item,
              nextIndent,
            )}`,
        )
        .join(",\n"),
      `${" ".repeat(indent)}}`,
    ].join("\n");
  }

  return JSON.stringify(value);
}

function isJsonPrimitive(value) {
  return value === null || typeof value !== "object";
}

function createQuarksJson(effect) {
  const textureNames = Array.from(
    new Set(effect.emitters.map((item) => item.texture)),
  ).sort();
  const materialKeys = Array.from(
    new Set(
      effect.emitters.map(
        (item) => `${item.texture}:${item.blending ?? "additive"}`,
      ),
    ),
  ).sort();

  const images = textureNames.map((texture) => ({
    uuid: imageUuid(texture),
    url: `${quarkRelativeTextureRoot}/${texture}`,
  }));
  const textures = textureNames.map((texture) => textureJson(texture));
  const materials = materialKeys.map((key) => {
    const [texture, blending] = key.split(":");
    return materialJson(texture, blending);
  });

  return {
    metadata: {
      version: 4.6,
      type: "Object",
      generator: "Animama particle VFX generator",
    },
    geometries: [billboardGeometry()],
    materials,
    textures,
    images,
    object: {
      uuid: uuid(effect.id, "group"),
      type: "Group",
      name: effect.label,
      layers: 1,
      matrix: matrix(),
      up: [0, 1, 0],
      children: effect.emitters.map((item) => ({
        uuid: uuid(effect.id, item.id, "emitter"),
        type: "ParticleEmitter",
        name: item.id,
        layers: 1,
        matrix: matrix(item.position ?? [0, 0, 0]),
        up: [0, 1, 0],
        ps: particleSystemJson(effect, item),
      })),
    },
  };
}

function particleSystemJson(effect, item) {
  const blending = item.blending ?? "additive";
  const behaviors = [
    {
      type: "ForceOverLife",
      x: value(item.force?.x ?? 0),
      y: value(item.force?.y ?? 0),
      z: value(item.force?.z ?? 0),
    },
    {
      type: "SizeOverLife",
      size: item.sizeOverLife,
    },
    {
      type: "ColorOverLife",
      color: item.color,
    },
    {
      type: "RotationOverLife",
      angularVelocity: value(item.rotation ?? 0),
    },
  ];
  if (item.frameOverLife) {
    behaviors.push(frameOverLife(item.frameOverLife));
  }
  behaviors.push(...(item.behaviors ?? []));

  return {
    version: "3.0",
    autoDestroy: false,
    looping: item.looping ?? false,
    prewarm: item.prewarm === true,
    duration: item.duration ?? effect.duration,
    shape: item.shape,
    startLife: value(item.startLife),
    startSpeed: value(item.startSpeed),
    startRotation: value(item.startRotation ?? 0),
    startSize: value(item.startSize),
    startColor: {
      type: "ConstantColor",
      color: { r: 1, g: 1, b: 1, a: 1 },
    },
    emissionOverTime: value(item.emissionOverTime ?? 0),
    emissionOverDistance: value(0),
    emissionBursts:
      item.burstCount > 0
        ? [
            {
              time: 0,
              count: value(item.burstCount),
              probability: 1,
              interval: 0.01,
              cycle: 1,
            },
          ]
        : [],
    onlyUsedByOther: false,
    instancingGeometry: billboardGeometryUuid(),
    renderOrder: item.renderOrder ?? 20,
    renderMode: item.renderMode ?? 0,
    rendererEmitterSettings: item.rendererEmitterSettings ?? {},
    material: materialUuid(item.texture, blending),
    layers: 1,
    startTileIndex: value(0),
    uTileCount: item.uTileCount ?? 1,
    vTileCount: item.vTileCount ?? 1,
    blendTiles: item.blendTiles === true,
    softParticles: false,
    softFarFade: 0,
    softNearFade: 0,
    behaviors,
    worldSpace: false,
  };
}

function emitter(id, options) {
  return { id, ...options };
}

function pointShape() {
  return { type: "point" };
}

function sphereShape(radius) {
  return {
    type: "sphere",
    radius,
    arc: Math.PI * 2,
    thickness: 1,
    mode: 0,
    spread: 0,
    speed: value(1),
  };
}

function coneShape(radius, angle) {
  return {
    type: "cone",
    radius,
    arc: Math.PI * 2,
    thickness: 1,
    angle,
    mode: 0,
    spread: 0,
    speed: value(1),
  };
}

function value(input) {
  if (Array.isArray(input)) {
    return { type: "IntervalValue", a: input[0], b: input[1] };
  }
  return { type: "ConstantValue", value: input };
}

function curve(p0, p1, p2, p3) {
  return {
    type: "PiecewiseBezier",
    functions: [
      {
        function: { p0, p1, p2, p3 },
        start: 0,
      },
    ],
  };
}

function linearCurve(start, end) {
  const delta = end - start;
  return curve(start, start + delta / 3, start + (delta * 2) / 3, end);
}

function frameOverLife(input) {
  return {
    type: "FrameOverLife",
    frame: linearCurve(input.startFrame, input.endFrame),
  };
}

function orbitOverLife(orbitSpeed, axis = [0, 1, 0]) {
  return {
    type: "OrbitOverLife",
    orbitSpeed: value(orbitSpeed),
    axis,
  };
}

function noiseBehavior(options = {}) {
  return {
    type: "Noise",
    frequency: value(options.frequency ?? 1),
    power: value(options.power ?? 0.04),
    positionAmount: value(options.positionAmount ?? 0.75),
    rotationAmount: value(options.rotationAmount ?? 0),
  };
}

function limitSpeedOverLife(speed, dampen = 0.5) {
  return {
    type: "LimitSpeedOverLife",
    speed: value(speed),
    dampen,
  };
}

function gradient(colorKeys, alphaKeys) {
  return {
    type: "Gradient",
    color: {
      type: "CLinearFunction",
      subType: "Color",
      keys: colorKeys.map(([value, pos]) => ({ value, pos })),
    },
    alpha: {
      type: "CLinearFunction",
      subType: "Number",
      keys: alphaKeys.map(([value, pos]) => ({ value, pos })),
    },
  };
}

function rgb(r, g, b) {
  return { r, g, b };
}

function billboardGeometryUuid() {
  return "animama-particle-vfx-billboard-geometry";
}

function billboardGeometry() {
  return {
    uuid: billboardGeometryUuid(),
    type: "PlaneGeometry",
    width: 1,
    height: 1,
    widthSegments: 1,
    heightSegments: 1,
  };
}

function textureJson(texture) {
  return {
    uuid: textureUuid(texture),
    name: texture,
    image: imageUuid(texture),
    mapping: 300,
    channel: 0,
    repeat: [1, 1],
    offset: [0, 0],
    center: [0, 0],
    rotation: 0,
    wrap: [1001, 1001],
    format: 1023,
    internalFormat: null,
    type: 1009,
    colorSpace: "",
    minFilter: 1008,
    magFilter: 1006,
    anisotropy: 1,
    flipY: true,
    generateMipmaps: true,
    premultiplyAlpha: false,
    unpackAlignment: 4,
  };
}

function materialJson(texture, blending) {
  return {
    uuid: materialUuid(texture, blending),
    type: "MeshBasicMaterial",
    color: 16777215,
    map: textureUuid(texture),
    reflectivity: 1,
    refractionRatio: 0.98,
    blending: BLENDING[blending] ?? BLENDING.additive,
    side: 2,
    transparent: true,
    depthFunc: 3,
    depthTest: true,
    depthWrite: false,
    colorWrite: true,
    stencilWrite: false,
    stencilWriteMask: 255,
    stencilFunc: 519,
    stencilRef: 0,
    stencilFuncMask: 255,
    stencilFail: 7680,
    stencilZFail: 7680,
    stencilZPass: 7680,
  };
}

function matrix(position = [0, 0, 0]) {
  return [
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}

function imageUuid(texture) {
  return uuid(texture, "image");
}

function textureUuid(texture) {
  return uuid(texture, "texture");
}

function materialUuid(texture, blending) {
  return uuid(texture, blending, "material");
}

function uuid(...parts) {
  return `animama-${parts.join("-").replace(/[^a-z0-9-]/gi, "-")}`;
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

This folder contains the tracked particle VFX texture set used by the avatar
\`three.quarks\` catalog and creator.

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
catalog. Runtime JSON files live in \`../quark\` and reference these textures
with paths relative to the quarks JSON file. The editor-facing texture manifest
lives in
\`src/frontend/web/src/lib/avatar/particle-vfx/editor/textureManifest.ts\` and
records the catalog id, role, recommended blending, and recommended render mode
for each picker texture. Atlas entries also record tile counts, frame counts,
blend-tile defaults, and recommended \`FrameOverLife\` frame ranges.
`;
}
