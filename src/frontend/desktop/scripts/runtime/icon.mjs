import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cacheRoot, desktopRoot, frontendRoot, run } from "./common.mjs";
import { iconFile } from "./windows-resources.mjs";

/** Render the checked-in vector mark into a multi-size Windows `.ico`. */
export async function buildWindowsIcon() {
  const require = createRequire(path.join(frontendRoot, "package.json"));
  const sharp = require("sharp");
  const output = path.join(cacheRoot, "release-icon");
  mkdirSync(output, { recursive: true });
  const svg = readFileSync(path.join(desktopRoot, "build/original-icon.svg"));
  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256])
    images.push({
      size,
      png: await sharp(svg).resize(size, size).png().toBuffer(),
    });
  const icon = path.join(output, "Animama.ico");
  writeFileSync(icon, iconFile(images));
  return icon;
}

/** Render the checked-in vector mark into Apple's complete iconset; no downloaded artwork. */
export async function buildIcon() {
  const require = createRequire(path.join(frontendRoot, "package.json"));
  const sharp = require("sharp");
  const output = path.join(cacheRoot, "release-icon");
  const iconset = path.join(output, "Animama.iconset");
  mkdirSync(iconset, { recursive: true });
  const svg = readFileSync(path.join(desktopRoot, "build/original-icon.svg"));
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2]) {
      await sharp(svg)
        .resize(size * scale, size * scale)
        .png()
        .toFile(
          path.join(
            iconset,
            `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
          ),
        );
    }
  const icon = path.join(output, "Animama.icns");
  run("/usr/bin/iconutil", ["--convert", "icns", "--output", icon, iconset], {
    capture: true,
  });
  return icon;
}
