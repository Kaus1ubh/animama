import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { desktopRoot } from "./common.mjs";
import { ScanError, scanCandidate } from "./release-scan.mjs";
import { verifyArtifactIndex } from "./release-artifacts.mjs";
import { releaseModelCandidates } from "./release-models.mjs";
import { modelDistribution } from "./model-publication.mjs";

/**
 * Private text is supplied from this machine at scan time, never committed:
 * the build user's home directory, the Git author email and any extra values
 * in ANIMAMA_SCAN_PRIVATE_TEXT (one per line).
 */
function privateText() {
  const needles = [{ label: "home-directory", value: `${homedir()}/` }];
  const email = spawnSync("git", ["config", "user.email"], {
    encoding: "utf8",
  }).stdout?.trim();
  if (email) needles.push({ label: "git-author-email", value: email });
  (process.env.ANIMAMA_SCAN_PRIVATE_TEXT ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value, index) =>
      needles.push({ label: `private-text-${index + 1}`, value }),
    );
  return needles;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      candidate: {
        type: "string",
        default: path.join(desktopRoot, "release/publish"),
      },
      gitleaks: { type: "string", default: process.env.ANIMAMA_GITLEAKS },
      config: {
        type: "string",
        default: path.join(desktopRoot, "runtime/release-scan.gitleaks.toml"),
      },
    },
  });
  if (!values.gitleaks)
    throw new ScanError(
      "Pass --gitleaks or set ANIMAMA_GITLEAKS to the verified pinned scanner binary",
    );
  const directory = path.resolve(values.candidate);
  const index = verifyArtifactIndex(directory);
  // A model-only candidate remains independently scannable. An app candidate
  // first binds all private model directories to its sealed runtime references.
  const directories = index.model_id
    ? [directory]
    : [
        ...releaseModelCandidates({
          directory,
          origin: modelDistribution().origin,
        }).map((candidate) => candidate.directory),
        directory,
      ];
  const options = {
    gitleaks: path.resolve(values.gitleaks),
    config: path.resolve(values.config),
    needles: privateText(),
    workRoot: tmpdir(),
  };
  for (const candidate of directories) {
    const receipt = await scanCandidate({ ...options, directory: candidate });
    const summary = Object.entries(
      Object.groupBy(receipt.findings, (item) => `${item.source}:${item.rule}`),
    ).map(([rule, items]) => `${rule} ×${items.length}`);
    const label =
      candidate === directory ? "candidate" : path.basename(candidate);
    console.log(
      receipt.result === "pass"
        ? `Release scan passed for ${label}: ${receipt.files.length} artifacts; receipt written to release-scan.json.`
        : `Release scan FAILED for ${label} (${summary.join(", ")}). Review release-scan.json; do not publish this candidate.`,
    );
    if (receipt.result !== "pass") process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  // Only our own bounded messages are printed; tool and filesystem errors can
  // contain host paths.
  console.error(
    error instanceof ScanError
      ? error.message
      : "Release scan failed; the candidate is not cleared. Set ANIMAMA_SCAN_DEBUG=1 to print the underlying error locally.",
  );
  if (process.env.ANIMAMA_SCAN_DEBUG === "1") console.error(error);
  process.exitCode = 1;
}
