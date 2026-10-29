import { existsSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { filesIn, sha256 } from "./common.mjs";
import { homeDirectoryNeedles, searchNeedles } from "./release-scan.mjs";

// These unapproved portrait names are forbidden in staged output. The filter
// and independent audit also catch copies left in stale build directories.
export const excludedDesktopWebAssets = Object.freeze([
  "korone-pfp.png",
  "marine-pfp.png",
  "gojo-pfp.png",
]);

// Routes where web builds copy Included content. Desktop resolves Included
// bytes through the content API, so embedded output must hold no such copies.
// The app's own stage scenes share `background/` from `public/background`.
export const includedAliasRoutes = Object.freeze([
  "background",
  "effects/scene-vfx",
  "effects/sfx",
  "effects/vfx",
  "effects/resources",
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

/**
 * Reject staged web files that contain the build user's home directory, such
 * as an absolute source path in Vite's manifest. The release scan repeats this
 * on the packaged candidate; the audit catches it in every stage. Vendored
 * files may carry their upstream authors' paths, so only this machine's home
 * directory is searched for.
 */
export async function assertNoHomeDirectoryPaths(
  webRoot,
  needles = homeDirectoryNeedles(),
) {
  for (const name of filesIn(webRoot)) {
    const labels = await searchNeedles(path.join(webRoot, name), needles);
    if (labels.length)
      throw new Error(
        `Staged web file contains the build user's home directory: ${name} (${labels.join(", ")})`,
      );
  }
}

/** Allow an alias route only for files identical to the tracked public source. */
export function assertNoIncludedAliasCopies(webRoot, publicRoot) {
  for (const route of includedAliasRoutes) {
    const built = path.join(webRoot, route);
    const stat = lstatSync(built, { throwIfNoEntry: false });
    if (!stat) continue;
    if (!stat.isDirectory())
      throw new Error(`Embedded web contains a compatibility alias: ${route}`);
    for (const name of filesIn(built)) {
      const source = path.join(publicRoot, route, name);
      if (
        !existsSync(source) ||
        sha256(source) !== sha256(path.join(built, name))
      )
        throw new Error(
          `Embedded web contains a compatibility alias: ${route}/${name}`,
        );
    }
  }
}
