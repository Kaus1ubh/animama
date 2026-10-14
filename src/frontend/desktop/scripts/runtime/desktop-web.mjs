import { lstatSync, rmSync } from "node:fs";
import path from "node:path";

// These unapproved portrait names are forbidden in staged output. The filter
// and independent audit also catch copies left in stale build directories.
export const excludedDesktopWebAssets = Object.freeze([
  "korone-pfp.png",
  "marine-pfp.png",
  "gojo-pfp.png",
]);

/** Remove only known, generated Vite public-file copies; never edit source assets. */
export function excludeDesktopWebAssets(webRoot) {
  for (const name of excludedDesktopWebAssets)
    rmSync(path.join(webRoot, name), { force: true });
  // Vite still copies tracked public assets when the compatibility plugin's
  // build aliases are disabled. Desktop resolves Included bytes through the
  // content API, so omit these duplicate directories from generated output.
  // The independent runtime audit separately rejects their presence.
  for (const alias of [
    "background",
    "effects/scene-vfx",
    "effects/sfx",
    "effects/vfx",
    "effects/resources",
  ])
    rmSync(path.join(webRoot, alias), { recursive: true, force: true });
}

/** The independent audit also rejects reintroduced files, including broken symlinks. */
export function assertDesktopWebAssets(webRoot) {
  for (const name of excludedDesktopWebAssets) {
    if (lstatSync(path.join(webRoot, name), { throwIfNoEntry: false }))
      throw new Error(`Unapproved desktop public asset: ${name}`);
  }
}
