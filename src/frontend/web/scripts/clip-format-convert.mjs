import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * One-off animaPoseClip/1.0 → 2.0 conversion for #337 (temporary: deleted
 * with the 1.0 converter).
 *
 *   pnpm -s animation convert-v1 --included [--dry-run]
 *   pnpm -s animation convert-v1 --local-root <dir> [--dry-run]
 *   pnpm -s animation convert-v1 --verify <git-revision>
 *
 * `--included` rewrites the 1.0 Gesture and Reaction clips under
 * `content/included` in place; their `.meta.json`, licence and source-review
 * records are left to the caller. `--local-root` converts every 1.0 clip file
 * under a Local content root and keeps the original beside it as
 * `<file>.v1.bak`. A clip is written only when its saved 2.0 bytes play like
 * the original within the converter's tolerances and keep its identity, loop
 * kind and Reaction fields; any failure is reported and nothing is written for
 * that file. `--dry-run` reports and writes nothing. `--verify <rev>` compares
 * each Included clip that was 1.0 at `<rev>` with its stored bytes.
 */
export async function runClipFormatConvert(args, { load, repoRoot, cwd, out }) {
  const dryRun = args.includes("--dry-run");
  const flag = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? null : (args[index + 1] ?? "");
  };
  const { convertClipFileText, verifyConvertedClip } = await load(
    "/scripts/clip-format-convert/convert.ts",
  );
  const included = path.join(repoRoot, "content/included");

  const verifyRevision = flag("--verify");
  if (verifyRevision === "") {
    out("--verify needs a git revision.");
    return 2;
  }
  if (verifyRevision !== null) {
    let failures = 0;
    let checked = 0;
    for (const file of includedClipFiles(included)) {
      const relative = path.relative(repoRoot, file);
      let original;
      try {
        original = execFileSync(
          "git",
          ["show", `${verifyRevision}:${relative}`],
          { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 26 },
        );
      } catch {
        continue; // Added after the revision.
      }
      if (JSON.parse(original).schema !== "animaPoseClip/1.0") continue;
      checked += 1;
      const result = verifyConvertedClip(original, readFileSync(file, "utf8"));
      if (result.ok) out(`ok      ${relative} ${formatError(result.error)}`);
      else {
        failures += 1;
        out(`FAILED  ${relative}: ${result.message}`);
      }
    }
    out(
      `${checked} clip(s) verified against ${verifyRevision}, ${failures} failed.`,
    );
    return failures === 0 && checked > 0 ? 0 : 1;
  }

  const localRoot = flag("--local-root");
  let files;
  if (args.includes("--included")) files = includedClipFiles(included);
  else if (localRoot) files = jsonFiles(path.resolve(cwd, localRoot));
  else {
    out(
      "Usage: convert-v1 --included | --local-root <dir> | --verify <rev> [--dry-run]",
    );
    return 2;
  }

  let converted = 0;
  let failed = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const result = convertClipFileText(text);
    const shown = path.relative(cwd, file);
    if (result.status === "skipped") continue;
    if (result.status === "failed") {
      failed += 1;
      out(`FAILED  ${shown}: ${result.message}`);
      continue;
    }
    converted += 1;
    out(
      `${dryRun ? "would convert" : "converted"} ${shown}: ${result.beats} beats, ` +
        `${result.bytesBefore} → ${result.bytesAfter} bytes, ${formatError(result.error)}`,
    );
    if (dryRun) continue;
    if (localRoot) writeFileSync(`${file}.v1.bak`, text);
    writeFileSync(file, result.saved);
  }
  out(
    `${converted} clip(s) ${dryRun ? "to convert" : "converted"}, ${failed} failed` +
      `${dryRun ? " (dry run: nothing written)" : ""}.`,
  );
  return failed === 0 ? 0 : 1;
}

function formatError({ degrees, metres, weight, added }) {
  const extra = Object.entries(added)
    .map(([channel, samples]) => `${channel}×${samples}`)
    .join(" ");
  return (
    `max ${degrees.toFixed(5)}° ${(metres * 1000).toFixed(4)} mm ${weight.toFixed(5)} weight` +
    (extra ? `, added ${extra}` : "")
  );
}

/** Included Gesture and Reaction sequence files (`<id>/<id>.json`). */
function includedClipFiles(included) {
  return ["gestures", "reactions"].flatMap((kind) =>
    readdirSync(path.join(included, kind), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(included, kind, entry.name, `${entry.name}.json`),
      )
      .sort(),
  );
}

/** Every `.json` file under a root except `.meta.json` control documents. */
function jsonFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".meta.json"),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}
