import path from "node:path";
import { desktopRoot, readJson, repoRoot, sha256 } from "./common.mjs";

/** Only deliberately bounded messages may reach CI logs. */
export class PublicationError extends Error {}

/**
 * Files the publisher derives after scanning: sanitized categorical smoke
 * reports, the human acceptance receipt and the regenerated integrity index.
 * Every other uploaded file must be covered by the candidate's scan receipt.
 */
const POST_SCAN_FILES = new Set([
  "smoke-name-report.json",
  "network-name-report.json",
  "manual-acceptance.json",
  "release-artifacts.json",
  "SHA256SUMS.txt",
]);

/**
 * Refuse to publish bytes that the pinned secret/privacy scan did not clear.
 * The receipt lists each scanned file's SHA-256, so it stays valid when stable
 * promotion rewrites the artifact index.
 */
export function verifyScanReceipt(directory, files) {
  let receipt;
  try {
    receipt = readJson(path.join(directory, "release-scan.json"));
  } catch {
    receipt = null;
  }
  const pinned = readJson(
    path.join(repoRoot, "scripts/repository-boundary/scanner-pins.json"),
  ).gitleaks.version;
  if (
    receipt?.schema !== "animama-release-scan/1" ||
    receipt.result !== "pass" ||
    receipt.scanner?.version !== pinned ||
    receipt.scanner?.canary !== "detected" ||
    // Only the reviewed allowlist may clear findings; a weakened --config may not.
    receipt.scanner?.config_sha256 !==
      sha256(path.join(desktopRoot, "runtime/release-scan.gitleaks.toml")) ||
    !Array.isArray(receipt.files)
  )
    throw new PublicationError(
      "A passing release scan is required; run pnpm desktop:release:scan on this candidate first",
    );
  const scanned = new Map(
    receipt.files.map((file) => [file.name, file.sha256]),
  );
  for (const file of files)
    if (
      !POST_SCAN_FILES.has(file.name) &&
      scanned.get(file.name) !== file.sha256
    )
      throw new PublicationError(
        "The release scan does not cover these exact artifacts; scan this candidate again",
      );
}
