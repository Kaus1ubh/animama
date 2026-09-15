import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cacheRoot, desktopRoot, frontendRoot, run } from "./common.mjs";

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
