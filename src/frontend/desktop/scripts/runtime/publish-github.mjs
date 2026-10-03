import { createReadStream, lstatSync } from "node:fs";
import path from "node:path";
import { isPublicReleaseRepository } from "./release-policy.mjs";
import {
  RELEASE_TARGETS,
  SHARED_RELEASE_NAMES,
  isWindowsReleaseName,
  mayResumeRelease,
} from "./release-artifacts.mjs";
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
 * Both targets share one release: each adds only its own files and leaves the
 * other target's alone, and a stable promotion uploads its feed last.
 */
export async function publishGithub({
  distribution,
  version,
  directory,
  files,
  preview,
  releaseBody,
  target = "darwin-arm64",
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
  const feed = RELEASE_TARGETS[target].feed;
  const ownName = (name) =>
    isWindowsReleaseName(name) === (target === "win32-x64");
  let remote = await api(`/releases/tags/v${version}`);
  const existing = remote
    ? await api(`/releases/${remote.id}/assets?per_page=100`)
    : [];
  if (!Array.isArray(existing) || existing.length > 64)
    throw new PublicationError("Unexpected release assets");
  const published = remote && !remote.draft && !remote.prerelease;
  // The other target's files mean this release is not only ours: a draft or
  // prerelease of theirs is never made public or stable by this run.
  const shared = existing.some(
    (asset) =>
      !ownName(asset.name) && !SHARED_RELEASE_NAMES.includes(asset.name),
  );
  if (shared && !published && !(preview && remote.prerelease && !remote.draft))
    throw new PublicationError(
      "This version's release holds the other target's unpublished draft or preview; publish that target first",
    );
  if (
    remote &&
    !mayResumeRelease(remote, version, {
      preview,
      feedPublished: existing.some((asset) => asset.name === feed),
    })
  )
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
  if (
    !mayResumeRelease(remote, version, {
      preview,
      feedPublished: existing.some((asset) => asset.name === feed),
    })
  )
    throw new PublicationError("Invalid GitHub release response");
  // Resume only byte-identical assets. Never delete or overwrite one; the
  // other target's own files are left as they are.
  if (
    existing.some(
      (asset) =>
        ownName(asset.name) && !files.some((file) => file.name === asset.name),
    )
  )
    throw new PublicationError(
      "Release contains unexpected assets; review it manually",
    );
  for (const file of files) {
    const found = existing.find((asset) => asset.name === file.name);
    if (
      found &&
      (found.state !== "uploaded" || found.digest !== `sha256:${file.sha256}`)
    )
      throw new PublicationError(
        "Existing release asset differs or is incomplete; review it manually before retrying",
      );
  }
  const pending = files
    .filter((file) => !existing.some((asset) => asset.name === file.name))
    .sort((a, b) => Number(a.name === feed) - Number(b.name === feed));
  for (const file of pending) {
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
  // Adding files to a release the other target already published changes
  // nothing else: not its description, and not which release is Latest, which
  // could otherwise move back to an older version. A shared preview keeps the
  // first target's description.
  const outcome = published
    ? remote
    : await api(`/releases/${remote.id}`, "PATCH", {
        draft: false,
        prerelease: preview,
        make_latest: preview ? "false" : "true",
        ...(shared ? {} : { body: releaseBody }),
      });
  if (
    outcome.draft !== false ||
    outcome.prerelease !== preview ||
    outcome.tag_name !== `v${version}`
  )
    throw new PublicationError(
      "Publication outcome is uncertain. Inspect this release before retrying",
    );
}
