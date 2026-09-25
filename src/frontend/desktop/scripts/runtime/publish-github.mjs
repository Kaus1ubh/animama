import { createReadStream, lstatSync } from "node:fs";
import path from "node:path";
import { isPublicReleaseRepository } from "./release-policy.mjs";
import { mayResumeRelease } from "./release-artifacts.mjs";
import { PublicationError } from "./publication.mjs";

/** Anonymous visibility is checked before reading a token or preparing reports. */
export async function preflightGithub(distribution) {
  if (!(await isPublicReleaseRepository(distribution)))
    throw new PublicationError(
      "Publication requires an anonymously readable public release repository",
    );
}

/**
 * Upload a fixed file list as a GitHub release of this version: a testing
 * prerelease for previews, the latest stable release otherwise. Byte-identical
 * assets in the same draft or preview resume; nothing is replaced or deleted.
 */
export async function publishGithub({
  distribution,
  version,
  directory,
  files,
  preview,
  releaseBody,
}) {
  const token = process.env.ANIMAMA_RELEASE_TOKEN;
  if (!token)
    throw new PublicationError(
      "A scoped release-repository token is required for publication; it is never packaged",
    );
  const repo = `${distribution.owner}/${distribution.repo}`;
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
  let remote = await api(`/releases/tags/v${version}`);
  if (remote && !mayResumeRelease(remote, version))
    throw new PublicationError(
      "Only this version's draft or testing prerelease may advance. Never replace a stable release; use a new version",
    );
  remote ??= await api("/releases", "POST", {
    tag_name: `v${version}`,
    name: `Animama ${version}`,
    draft: true,
    prerelease: preview,
    body: releaseBody,
  });
  if (!mayResumeRelease(remote, version))
    throw new PublicationError("Invalid GitHub release response");
  // Resume only byte-identical assets in the same draft/preview. Never delete or overwrite one.
  const existing = await api(`/releases/${remote.id}/assets?per_page=100`);
  if (!Array.isArray(existing) || existing.length > 64)
    throw new PublicationError("Unexpected release assets");
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
    published.tag_name !== `v${version}`
  )
    throw new PublicationError(
      "Publication outcome is uncertain. Inspect this release before retrying",
    );
}
