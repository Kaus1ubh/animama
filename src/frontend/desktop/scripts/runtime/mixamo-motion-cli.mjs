/**
 * Owner commands for the non-portable Mixamo-motion pack. Every command prints
 * paths and counts only; credentials come from the environment (an owner-only
 * file) and are never printed.
 *
 *   verify            check build-inputs/ against the tracked manifest
 *   fetch             download the pack from the private store, then verify
 *   publish [--confirm]  upload a verified pack (dry run by default)
 *   scan <path...> | --git   fail if any path, archive or tracked file holds pack bytes
 *   manifest <dir> <version>  print a manifest for a local pack (owner)
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { readJson, repoRoot, run } from "./common.mjs";
import { PublicationError } from "./publication.mjs";
import {
  INPUT_DIR,
  PRIVATE_INVENTORY_PATH,
  PackError,
  fetchPack,
  manifestFor,
  publishPack,
  readManifest,
  scanForPackBytes,
  verifyPack,
} from "./mixamo-motion.mjs";

const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--");

async function main() {
  if (command === "verify") {
    const manifest = readManifest();
    const problems = verifyPack({
      dir: INPUT_DIR,
      manifest,
      privateInventory: existsSync(PRIVATE_INVENTORY_PATH)
        ? readJson(PRIVATE_INVENTORY_PATH)
        : null,
    });
    for (const problem of problems)
      console.error(`${problem.path}: ${problem.reason}`);
    if (problems.length) throw new PackError("Verification failed");
    console.log(`Verified ${manifest.files.length} files: pass`);
  } else if (command === "fetch") {
    const { files } = await fetchPack({});
    console.log(`Fetched and verified ${files} files`);
  } else if (command === "publish") {
    const result = await publishPack({ confirm: rest.includes("--confirm") });
    console.log(
      result.dryRun
        ? `Dry run: ${result.objects} objects would be uploaded; pass --confirm`
        : `Uploaded ${result.objects} objects`,
    );
  } else if (command === "scan") {
    // pnpm runs scripts in the package directory; resolve from the caller's.
    const base = process.env.INIT_CWD ?? process.cwd();
    const targets = rest.includes("--git")
      ? run("git", ["ls-files", "-z"], { cwd: repoRoot, capture: true })
          .split("\0")
          .filter(Boolean)
          .map((file) => path.join(repoRoot, file))
      : rest.map((target) => path.resolve(base, target));
    if (!targets.length) throw new PackError("Name at least one path to scan");
    // Tracked files deleted from the worktree are not part of the candidate.
    const findings = scanForPackBytes(targets, {
      skipMissing: rest.includes("--git"),
    });
    for (const finding of findings) console.error(`pack bytes: ${finding}`);
    if (findings.length) throw new PackError("Pack bytes found");
    console.log("No pack bytes found");
  } else if (command === "manifest") {
    const [dir, version] = rest;
    if (!dir || !version)
      throw new PackError("Usage: manifest <dir> <version>");
    const base = process.env.INIT_CWD ?? process.cwd();
    console.log(
      JSON.stringify(manifestFor(path.resolve(base, dir), version), null, 2),
    );
  } else {
    throw new PackError(
      "Usage: mixamo-motion verify | fetch | publish [--confirm] | scan <path...> | manifest <dir> <version>",
    );
  }
}

main().catch((error) => {
  // Pack and publication errors carry safe, actionable messages.
  console.error(
    error instanceof PackError || error instanceof PublicationError
      ? error.message
      : "Mixamo-motion command failed",
  );
  process.exitCode = 1;
});
