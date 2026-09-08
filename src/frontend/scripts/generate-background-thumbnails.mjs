import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 270;
const JPEG_QUALITY = 82;
const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const backgroundDir = path.join(projectRoot, "web", "public", "background");
const thumbsDir = path.join(backgroundDir, "thumbs");

async function main() {
  const entries = await readdir(backgroundDir, { withFileTypes: true });
  const sourceFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) =>
      SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase()),
    )
    .sort((left, right) => left.localeCompare(right));

  if (sourceFiles.length === 0) {
    throw new Error(`No source backgrounds found in ${backgroundDir}`);
  }

  await mkdir(thumbsDir, { recursive: true });

  for (const fileName of sourceFiles) {
    const sourcePath = path.join(backgroundDir, fileName);
    const outputName = `${path.parse(fileName).name}.jpg`;
    const outputPath = path.join(thumbsDir, outputName);

    await sharp(sourcePath)
      .resize(THUMB_WIDTH, THUMB_HEIGHT, {
        fit: "cover",
        position: "attention",
      })
      .jpeg({
        quality: JPEG_QUALITY,
        mozjpeg: true,
      })
      .toFile(outputPath);

    console.log(
      `Generated ${path.relative(projectRoot, outputPath)} from ${path.relative(projectRoot, sourcePath)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
