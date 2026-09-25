import { createReadStream, copyFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { desktopRoot, readJson, sha256, writeJson } from "./common.mjs";
import {
  isPublicReleaseRepository,
  loadReleasePolicy,
} from "./release-policy.mjs";
import {
  candidateDistribution,
  verifyArtifactIndex,
  writeArtifactIndex,
  previewAssets,
  mayResumeRelease,
} from "./release-artifacts.mjs";
import {
  acceptsRequiredNameSmoke,
  validateManualAcceptance,
} from "./smoke-policy.mjs";

/** Only deliberately bounded messages may reach CI logs. */
class PublicationError extends Error {}

/** Promotion is a separate, explicitly authorized operation; builds never upload themselves. */
async function publish() {
  const operation = process.argv.slice(2).join(" ");
  if (
    !["--confirm-publication", "--confirm-preview-publication"].includes(
      operation,
    )
  )
    throw new PublicationError(
      "Use --confirm-preview-publication for explicitly approved public testing, or --confirm-publication with the exact human acceptance receipt",
    );
  const preview = operation === "--confirm-preview-publication";
  const releaseBody = preview
    ? "Public testing preview for macOS arm64. Native acceptance is NOT complete; this is not a stable update. Back up test data and see the attached notices and size reports."
    : "Self-contained macOS arm64 application (macOS 15+). See the attached notices, checksums, size, and acceptance reports. Local data stays on your computer.";
  const release = loadReleasePolicy();
  const directory = path.join(desktopRoot, "release/publish");
  // The candidate's sealed feed and pack URLs decide where it may be published.
  const built = candidateDistribution(directory);
  if (
    !built ||
    JSON.stringify(built) !== JSON.stringify(release.updatePolicy.distribution)
  )
    throw new PublicationError(
      "The candidate was built for a different distribution than ANIMAMA_RELEASE_DISTRIBUTION selects, or records none; publish with the selection used to build it",
    );
  if (built.kind !== "github")
    throw new PublicationError(
      "This candidate targets R2, and R2 publication is not available yet; only GitHub-distribution candidates can be published",
    );
  // Run before preparing promotion reports, reading a token or mutating GitHub.
  // A local candidate build deliberately performs no repository-visibility check.
  if (!(await isPublicReleaseRepository(release.distribution)))
    throw new PublicationError(
      "Publication requires an anonymously readable public release repository",
    );
  const index = verifyArtifactIndex(directory);
  if (index.app_version !== release.version)
    throw new PublicationError("Release version mismatch");
  const dmg = `Animama-${release.version}-arm64.dmg`;
  const dmgSha256 = sha256(path.join(directory, dmg));
  const receipt = preview
    ? null
    : validateManualAcceptance(
        JSON.parse(process.env.ANIMAMA_MACOS_ACCEPTANCE ?? "null"),
        dmgSha256,
        release.version,
      );
  const names = index.files.map((file) => file.name);
  const folder = path.join(desktopRoot, "release/smoke-name");
  const smoke = readJson(path.join(folder, "smoke-report.json"));
  const network = readJson(path.join(folder, "network-report.json"));
  if (
    !acceptsRequiredNameSmoke(smoke, network, {
      dmgSha256,
      runtimeBuildId: index.runtime_build_id,
    })
  )
    throw new PublicationError(
      "The fresh-profile smoke must reject blank names and complete named setup for this exact artifact",
    );
  for (const kind of preview ? [] : ["smoke", "network"]) {
    const name = `${kind}-name-report.json`;
    copyFileSync(
      path.join(folder, `${kind}-report.json`),
      path.join(directory, name),
    );
    names.push(name);
  }
  if (!preview) {
    writeJson(path.join(directory, "manual-acceptance.json"), receipt);
    names.push("manual-acceptance.json");
  }
  const final = preview
    ? index
    : writeArtifactIndex(directory, release.version, names, {
        runtime_build_id: index.runtime_build_id,
        smoke_verified: true,
        manual_verified: true,
      });
  const token = process.env.ANIMAMA_RELEASE_TOKEN;
  if (!token)
    throw new PublicationError(
      "A scoped release-repository token is required for publication; it is never packaged",
    );
  const repo = `${release.distribution.owner}/${release.distribution.repo}`;
  const api = async (suffix, method = "GET", body) => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}${suffix}`,
      {
        method,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 404 && method === "GET") return null;
    if (!response.ok)
      throw new PublicationError(
        `GitHub release operation failed (${response.status}); inspect the draft or preview without replacing existing assets`,
      );
    return response.json();
  };
  const repository = await api("");
  if (!repository || repository.private !== false)
    throw new PublicationError(
      "Public anonymous installer/update downloads are required",
    );
  let remote = await api(`/releases/tags/v${release.version}`);
  if (remote && !mayResumeRelease(remote, release.version))
    throw new PublicationError(
      "Only this version's draft or testing prerelease may advance. Never replace a stable release; use a new version",
    );
  remote ??= await api("/releases", "POST", {
    tag_name: `v${release.version}`,
    name: `Animama ${release.version}`,
    draft: true,
    prerelease: preview,
    body: releaseBody,
  });
  if (!mayResumeRelease(remote, release.version))
    throw new PublicationError("Invalid GitHub release response");
  // Resume only byte-identical assets in the same draft/preview. Never delete or overwrite one.
  const existing = await api(`/releases/${remote.id}/assets?per_page=100`);
  if (!Array.isArray(existing) || existing.length > 64)
    throw new PublicationError("Unexpected release assets");
  const files = preview
    ? previewAssets(final)
    : [
        ...final.files,
        ...["release-artifacts.json", "SHA256SUMS.txt"].map((name) => ({
          name,
          sha256: sha256(path.join(directory, name)),
        })),
      ];
  if (existing.some((asset) => !files.some((file) => file.name === asset.name)))
    throw new PublicationError(
      "Release contains unexpected assets; review it manually",
    );
  for (const file of files) {
    const found = existing.find((asset) => asset.name === file.name);
    if (found) {
      if (
        found.state !== "uploaded" ||
        found.digest !== `sha256:${file.sha256}`
      )
        throw new PublicationError(
          "Existing release asset differs or is incomplete; review it manually before retrying",
        );
      continue;
    }
    const response = await fetch(
      `https://uploads.github.com/repos/${repo}/releases/${remote.id}/assets?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(
            lstatSync(path.join(directory, file.name)).size,
          ),
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: createReadStream(path.join(directory, file.name)),
        duplex: "half",
        signal: AbortSignal.timeout(20 * 60_000),
      },
    );
    if (
      !response.ok ||
      (await response.json()).digest !== `sha256:${file.sha256}`
    )
      throw new PublicationError(
        "Release asset upload was not verified; stable promotion did not occur",
      );
  }
  const published = await api(`/releases/${remote.id}`, "PATCH", {
    draft: false,
    prerelease: preview,
    make_latest: preview ? "false" : "true",
    body: releaseBody,
  });
  if (
    published.draft !== false ||
    published.prerelease !== preview ||
    published.tag_name !== `v${release.version}`
  )
    throw new PublicationError(
      "Publication outcome is uncertain. Inspect this release before retrying",
    );
  console.log(
    preview
      ? `Published Animama ${release.version} for testing only. Stable feed and promotion remain gated on native acceptance.`
      : `Published verified Animama ${release.version} to the configured public release repository.`,
  );
}

try {
  await publish();
} catch (error) {
  // Only our own bounded summaries are emitted; fetch/stream errors can include credentials or host paths.
  console.error(
    error instanceof PublicationError
      ? error.message
      : "Release publication failed; inspect the draft/preview and private CI state before retrying.",
  );
  process.exitCode = 1;
}
