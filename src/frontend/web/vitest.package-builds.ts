import { readFile, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

import {
  packageSourceDigest,
  SOURCE_DIGEST_FILE,
} from "../scripts/package-source-digest.mjs";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const packagesRoot = fileURLToPath(new URL("../packages", import.meta.url));

/** Read a recorded digest, or null when the build has none. */
async function readRecordedDigest(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Vitest global setup: refuse to run against a linked workspace package build
 * made from other source than this checkout's.
 *
 * Web code imports `@animama/*` packages through their built `dist`, not their
 * source. A stale build (made at another revision, interrupted, or reached
 * through another checkout's `node_modules`) would make tests exercise old
 * package code and fail, or pass, misleadingly.
 */
export default async function verifyLinkedPackageBuilds() {
  const manifest = JSON.parse(
    await readFile(join(webRoot, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const linked = Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })
    .filter(([, version]) => version.startsWith("workspace:"))
    .map(([name]) => name);

  const problems: string[] = [];
  for (const name of linked) {
    const source = join(packagesRoot, basename(name));
    let installed: string;
    try {
      installed = await realpath(join(webRoot, "node_modules", name));
    } catch {
      problems.push(`${name}: not installed; run \`pnpm install\``);
      continue;
    }
    const recorded = await readRecordedDigest(
      join(installed, "dist", SOURCE_DIGEST_FILE),
    );
    if (recorded === null) {
      problems.push(`${name}: ${installed}/dist has no source digest`);
    } else if (recorded !== (await packageSourceDigest(source))) {
      problems.push(
        `${name}: ${installed}/dist was built from other source than ${source}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      [
        "Linked package builds do not match this checkout's source:",
        ...problems.map((problem) => `  - ${problem}`),
        "Web tests import these packages' built dist. From src/frontend, run `pnpm packages:build`, then rerun the tests.",
      ].join("\n"),
    );
  }
}
