import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { desktopRoot, frontendRoot, run } from "./common.mjs";
import { iconFile } from "./windows-resources.mjs";

/** Checked-in app icons, generated from the brand mark by `pnpm icons`. */
export const macIcon = path.join(desktopRoot, "build/icon.icns");
// The 1024 px tile behind `macIcon`; unpackaged runs show it in the Dock.
export const macTileImage = path.join(desktopRoot, "build/icon-mac.png");
export const windowsIcon = path.join(desktopRoot, "build/icon.ico");
export const linuxIcon = path.join(desktopRoot, "build/icon.png");

/** The approved transparent mascot mark; the only artwork source. */
const markSource = path.join(frontendRoot, "web/public/brand/animama-mark.png");

/**
 * macOS tile on Apple's 1024 px icon grid: an 824 px rounded square inset
 * 100 px. macOS 26 keeps an icon of exactly this shape out of the gray plate
 * it puts around free-form icons, so the tile must stay opaque edge to edge.
 */
const MAC_CANVAS = 1024;
const MAC_TILE = 824;
const MAC_TILE_RADIUS = 185.4;
const MAC_TILE_COLORS = ["#f1f8ff", "#d3e8fb"];
// The mark's longer side as a fraction of the tile.
const MAC_MARK_SCALE = 0.72;
// Transparent icons keep a small margin so the rays are not clipped.
const FLAT_MARK_SCALE = 0.94;

const WINDOWS_SIZES = [16, 24, 32, 48, 64, 128, 256];
const LINUX_SIZE = 1024;

function loadSharp() {
  return createRequire(path.join(frontendRoot, "package.json"))("sharp");
}

/** The mark trimmed to its visible pixels and fitted inside a `size` square. */
async function fittedMark(sharp, size) {
  const trimmed = await sharp(markSource).trim().png().toBuffer();
  return sharp(trimmed)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** The transparent mark centred on a square canvas, for Windows and Linux. */
async function flatIcon(sharp, size) {
  const inner = Math.round(size * FLAT_MARK_SCALE);
  const offset = Math.floor((size - inner) / 2);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: await fittedMark(sharp, inner), left: offset, top: offset },
    ])
    .png()
    .toBuffer();
}

/** The 1024 px macOS master: the mark on its grid-aligned tile. */
export async function macTile({
  colors = MAC_TILE_COLORS,
  scale = MAC_MARK_SCALE,
} = {}) {
  const sharp = loadSharp();
  const inset = (MAC_CANVAS - MAC_TILE) / 2;
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MAC_CANVAS}" height="${MAC_CANVAS}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
      </linearGradient></defs>
      <rect x="${inset}" y="${inset}" width="${MAC_TILE}" height="${MAC_TILE}"
        rx="${MAC_TILE_RADIUS}" fill="url(#g)"/>
    </svg>`,
  );
  const inner = Math.round(MAC_TILE * scale);
  const offset = Math.floor((MAC_CANVAS - inner) / 2);
  return sharp(tile)
    .composite([
      { input: await fittedMark(sharp, inner), left: offset, top: offset },
    ])
    .png()
    .toBuffer();
}

/** Write a complete `.icns` from a 1024 px master with `iconutil`. */
async function writeIcns(sharp, master, output) {
  const work = mkdtempSync(path.join(tmpdir(), "animama-icon-"));
  try {
    const iconset = path.join(work, "Animama.iconset");
    mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512])
      for (const scale of [1, 2])
        await sharp(master)
          .resize(size * scale, size * scale)
          .png()
          .toFile(
            path.join(
              iconset,
              `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
            ),
          );
    run(
      "/usr/bin/iconutil",
      ["--convert", "icns", "--output", output, iconset],
      {
        capture: true,
      },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Regenerate every checked-in app icon from the brand mark (macOS only). */
export async function generateIcons() {
  const sharp = loadSharp();
  const tile = await macTile();
  writeFileSync(macTileImage, tile);
  await writeIcns(sharp, tile, macIcon);
  const images = [];
  for (const size of WINDOWS_SIZES)
    images.push({ size, png: await flatIcon(sharp, size) });
  writeFileSync(windowsIcon, iconFile(images));
  writeFileSync(linuxIcon, await flatIcon(sharp, LINUX_SIZE));
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await generateIcons();
