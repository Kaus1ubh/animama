#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BoundsFile = {
  generatedAt: string;
  files: Record<
    string,
    {
      fileName: string;
      assetPath: string;
      width: number;
      height: number;
      pixelRects: {
        face: Rect;
        leftEye: Rect;
        rightEye: Rect;
        mouth: Rect;
      };
      normalizedRects: {
        face: Rect;
        leftEye: Rect;
        rightEye: Rect;
        mouth: Rect;
      };
    }
  >;
};

type Side = "left" | "right";

type OverlayRecipe = {
  id: string;
  assetPath: string;
  widthScale: number;
  heightScale: number;
  offsetX: number;
  offsetY: number;
  zIndex: number;
};

type Placement = {
  recipeId: string;
  side: Side;
  assetPath: string;
  mirrored: boolean;
  rect: Rect;
};

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, "..");
const EFFECTS_DIR = path.join(FRONTEND_ROOT, "web", "public", "effects");
const BOUNDS_PATH = path.join(EFFECTS_DIR, "face-material-bounds.json");
const OUTPUT_DIR = path.join(EFFECTS_DIR, "composited");
const OUTPUT_MANIFEST = path.join(
  EFFECTS_DIR,
  "face-material-overlay-placements.json",
);

const OVERLAY_RECIPES: OverlayRecipe[] = [
  {
    id: "eye_vv",
    assetPath: "/effects/vfx/eye_vv_left.png",
    widthScale: 1,
    heightScale: 1,
    offsetX: 0,
    offsetY: 0,
    zIndex: 20,
  },
  {
    id: "blush",
    assetPath: "/effects/vfx/blush_left.png",
    widthScale: 1.35,
    heightScale: 1.05,
    offsetX: 0.18,
    offsetY: 0.78,
    zIndex: 10,
  },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = clamp(rect.x, 0, width);
  const y = clamp(rect.y, 0, height);
  const maxWidth = width - x;
  const maxHeight = height - y;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(clamp(rect.width, 1, maxWidth)),
    height: Math.round(clamp(rect.height, 1, maxHeight)),
  };
}

function resolveAssetPath(assetPath: string) {
  return path.join(
    FRONTEND_ROOT,
    "web",
    "public",
    assetPath.replace(/^\//u, ""),
  );
}

function buildPlacement(args: {
  recipe: OverlayRecipe;
  eyeRect: Rect;
  imageWidth: number;
  imageHeight: number;
  side: Side;
}): Placement {
  const { recipe, eyeRect, imageWidth, imageHeight, side } = args;
  const sign = side === "left" ? -1 : 1;
  const width = eyeRect.width * recipe.widthScale;
  const height = eyeRect.height * recipe.heightScale;
  const centerX =
    eyeRect.x + eyeRect.width / 2 + sign * eyeRect.width * recipe.offsetX;
  const centerY =
    eyeRect.y + eyeRect.height / 2 + eyeRect.height * recipe.offsetY;
  const rect = clampRect(
    {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    },
    imageWidth,
    imageHeight,
  );

  return {
    recipeId: recipe.id,
    side,
    assetPath: recipe.assetPath,
    mirrored: side === "right",
    rect,
  };
}

async function loadBoundsFile() {
  const raw = await readFile(BOUNDS_PATH, "utf8");
  return JSON.parse(raw) as BoundsFile;
}

async function renderOverlayBuffer(placement: Placement) {
  let pipeline = sharp(resolveAssetPath(placement.assetPath))
    .resize(placement.rect.width, placement.rect.height, { fit: "fill" })
    .png();

  if (placement.mirrored) {
    pipeline = pipeline.flop();
  }

  return pipeline.toBuffer();
}

async function compositeForFile(
  entry: BoundsFile["files"][string],
): Promise<{ outputPath: string; placements: Placement[] }> {
  const baseFilePath = path.join(EFFECTS_DIR, entry.fileName);
  const leftEye = entry.pixelRects.leftEye;
  const rightEye = entry.pixelRects.rightEye;

  const placements = OVERLAY_RECIPES.flatMap((recipe) => [
    buildPlacement({
      recipe,
      eyeRect: leftEye,
      imageWidth: entry.width,
      imageHeight: entry.height,
      side: "left",
    }),
    buildPlacement({
      recipe,
      eyeRect: rightEye,
      imageWidth: entry.width,
      imageHeight: entry.height,
      side: "right",
    }),
  ]).sort((a, b) => {
    const recipeA = OVERLAY_RECIPES.find((recipe) => recipe.id === a.recipeId);
    const recipeB = OVERLAY_RECIPES.find((recipe) => recipe.id === b.recipeId);
    return (recipeA?.zIndex ?? 0) - (recipeB?.zIndex ?? 0);
  });

  const compositeInputs = await Promise.all(
    placements.map(async (placement) => ({
      input: await renderOverlayBuffer(placement),
      left: placement.rect.x,
      top: placement.rect.y,
    })),
  );

  const outputPath = path.join(OUTPUT_DIR, entry.fileName);
  await sharp(baseFilePath).composite(compositeInputs).png().toFile(outputPath);

  return { outputPath, placements };
}

async function main() {
  const bounds = await loadBoundsFile();
  await mkdir(OUTPUT_DIR, { recursive: true });

  const manifestEntries = await Promise.all(
    Object.values(bounds.files).map(async (entry) => {
      const { outputPath, placements } = await compositeForFile(entry);
      return [
        entry.assetPath,
        {
          baseAssetPath: entry.assetPath,
          outputAssetPath: `/effects/composited/${entry.fileName}`,
          placements,
        },
      ] as const;
    }),
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceBoundsPath: "/effects/face-material-bounds.json",
    recipes: OVERLAY_RECIPES,
    files: Object.fromEntries(manifestEntries),
  };

  await writeFile(
    OUTPUT_MANIFEST,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(`Wrote ${OUTPUT_MANIFEST}`);
  for (const entry of manifestEntries) {
    console.log(`${entry[0]} -> ${entry[1].outputAssetPath}`);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});
