import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** File in a package's `dist` that records the source digest the build was made from. */
export const SOURCE_DIGEST_FILE = ".source-digest";

/**
 * Digest a workspace package's build inputs: its manifest and every file under `src`.
 * The package build records this value in `dist`; consumers compare it with the
 * current source to detect a build made from other source.
 */
export async function packageSourceDigest(packageRoot) {
  const sourceFiles = (await readdir(join(packageRoot, "src"), { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(packageRoot, join(entry.parentPath, entry.name)).split(sep).join("/"));
  const hash = createHash("sha256");
  for (const file of ["package.json", ...sourceFiles.sort()]) {
    const contents = await readFile(join(packageRoot, file));
    hash.update(`${file}\0${contents.length}\0`);
    hash.update(contents);
  }
  return hash.digest("hex");
}
