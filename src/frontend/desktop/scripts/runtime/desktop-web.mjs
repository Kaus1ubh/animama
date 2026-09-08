import { lstatSync, rmSync } from "node:fs";
import path from "node:path";

// These legacy portraits have no redistribution approval and are unused by the
// app. Keep private development sources, but never include their copied output.
export const excludedDesktopWebAssets = Object.freeze([
  "korone-pfp.png",
  "marine-pfp.png",
  "gojo-pfp.png",
]);

/** Remove only known, generated Vite public-file copies; never edit source assets. */
export function excludeDesktopWebAssets(webRoot) {
  for (const name of excludedDesktopWebAssets)
    rmSync(path.join(webRoot, name), { force: true });
}

/** The independent audit also rejects reintroduced files, including broken symlinks. */
export function assertDesktopWebAssets(webRoot) {
  for (const name of excludedDesktopWebAssets) {
    if (lstatSync(path.join(webRoot, name), { throwIfNoEntry: false }))
      throw new Error(`Unapproved desktop public asset: ${name}`);
  }
}
