import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { normalizePath, type Plugin } from "vite";

/** Lossy quality for sticker art; alpha stays lossless (#655). */
const STICKER_WEBP_QUALITY = 90;
// libwebp effort 0-6. Effort 6 took about 40 s for the 42 stickers against
// 0.2 s at 4, for 2% smaller files (2026-10-22), so builds use 4.
const STICKER_WEBP_EFFORT = 4;

/**
 * A comparable directory path. Vite hands the plugin real paths, so resolve
 * symlinks and, on Windows, case; a missing directory keeps its resolved form.
 */
function canonicalDirectory(directory: string): string {
  let real = path.resolve(directory);
  try {
    real = realpathSync.native(real);
  } catch {
    // Nothing on disk to match against; compare the resolved path.
  }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

/**
 * Ship the built-in Scene stickers as WebP in production builds (#655).
 *
 * `stickers.ts` imports each Included sticker PNG with `?url`. In a build this
 * plugin answers those imports itself, emitting a WebP copy (lossy quality 90,
 * lossless alpha) whenever it is smaller than the PNG. The PNG files stay the
 * masters, and development keeps serving them. Stickers render as DOM images,
 * so the colour under fully transparent pixels never shows.
 */
export function webpStickerAssetsPlugin({
  stickerRoot,
}: {
  stickerRoot: string;
}): Plugin {
  let stickerDirectory: string | undefined;
  return {
    name: "animama-webp-sticker-assets",
    apply: "build",
    enforce: "pre",
    async load(id) {
      const [file, query] = id.split("?", 2);
      if (
        query !== "url" ||
        !file?.endsWith(".png") ||
        canonicalDirectory(path.dirname(file)) !==
          (stickerDirectory ??= canonicalDirectory(stickerRoot))
      )
        return null;
      const master = await readFile(file);
      const webp = await sharp(master)
        .webp({
          quality: STICKER_WEBP_QUALITY,
          alphaQuality: 100,
          effort: STICKER_WEBP_EFFORT,
        })
        .toBuffer();
      const smaller = webp.length < master.length;
      const name = path.basename(file, ".png") + (smaller ? ".webp" : ".png");
      const reference = this.emitFile({
        type: "asset",
        name,
        // The build manifest keys assets by this name, so keep it relative to
        // the Vite root, as Vite's own assets are; an absolute path would ship
        // the build machine's checkout location.
        originalFileName: normalizePath(
          path.relative(this.environment.config.root, file),
        ),
        source: smaller ? webp : master,
      });
      // Vite resolves this placeholder to the hashed asset URL under the
      // build's base path, as it does for its own `?url` imports.
      return {
        code: `export default "__VITE_ASSET__${reference}__";`,
        moduleType: "js",
      };
    },
  };
}
