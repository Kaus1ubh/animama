import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PublicationError } from "./publication.mjs";
import {
  IMMUTABLE,
  keyPath,
  publicGet,
  r2Exists,
  r2Writer,
  verifyPublicObject,
} from "./r2-objects.mjs";

export { r2Credentials } from "./r2-objects.mjs";

const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/u;

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

/**
 * `url` with a one-off query. The edge caches by full URL, so this read
 * bypasses any cached copy of `url`, and a 404 it caches never reaches `url`.
 */
const uncached = (url) => `${url}?noCache=${randomBytes(6).toString("hex")}`;

/** The public stable feed's bytes, bypassing caches, or null before the first release. */
async function fetchFeed(fetchImpl, distribution, feed) {
  const response = await publicGet(
    fetchImpl,
    uncached(`${distribution.base_url}/${feed}`),
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new PublicationError(
      "The public R2 domain did not serve the release feed; check the custom domain before retrying",
    );
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The version the target's public stable feed currently names, or null before
 * its first release. A YAML feed has `version: x`; a JSON one `"version": "x"`.
 */
async function publishedVersion(fetchImpl, distribution, feed) {
  const bytes = await fetchFeed(fetchImpl, distribution, feed);
  if (!bytes) return null;
  const version = /^\s*"?version"?:\s*['"]?([^'",\s]+)/mu.exec(
    bytes.toString("utf8"),
  )?.[1];
  if (!version || !VERSION.test(version))
    throw new PublicationError(
      "The public R2 feed is unreadable; inspect it before publishing",
    );
  return version;
}

/**
 * Before reading credentials or preparing reports: the public domain must
 * answer, and this version must be newer than the target's published stable
 * feed (`latest-mac.yml` or `latest.yml`).
 */
export async function preflightR2({
  distribution,
  version,
  feed = "latest-mac.yml",
  fetch: fetchImpl = fetch,
}) {
  const current = await publishedVersion(fetchImpl, distribution, feed);
  if (current === version)
    throw new PublicationError(
      "The public feed already names this version, so it is published; verify it rather than publishing again",
    );
  if (current && compareVersions(current, version) > 0)
    throw new PublicationError(
      "The public feed names a newer version. Never replace a stable release; use a new version",
    );
}

/**
 * Publish to R2: create-only uploads into `<base>/v<version>/` of the objects
 * the bucket does not already hold, anonymous verification of every object,
 * and, for stable promotion only, the target's root feed written last. Nothing
 * is overwritten except that feed, so an interrupted run leaves the previous
 * stable release in place and resumes with byte-identical objects. `shared`
 * names files the other target may already have published; they must match
 * byte for byte before any upload.
 */
export async function publishR2({
  distribution,
  bucket,
  version,
  directory,
  files,
  preview,
  credentials,
  feed = "latest-mac.yml",
  shared = [],
  fetch: fetchImpl = fetch,
  retryDelayMs = 5_000,
}) {
  const base = new URL(distribution.base_url);
  const prefix = base.pathname.slice(1);
  const versionKey = (name) => `${prefix}/v${version}/${name}`;
  for (const file of files.filter((item) => shared.includes(item.name))) {
    // Never the exact URL: a 404 cached there would stall its verification.
    const response = await publicGet(
      fetchImpl,
      uncached(`${base.origin}/${keyPath(versionKey(file.name))}`),
    );
    if (response.status === 404) continue;
    if (!response.ok)
      throw new PublicationError(
        `The public R2 domain did not answer for ${file.name}; check it before retrying`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
      throw new PublicationError(
        `${file.name} is already published with different bytes; both targets must publish identical shared files`,
      );
  }
  const put = r2Writer({ bucket, credentials, fetch: fetchImpl });
  const exists = r2Exists({ bucket, credentials, fetch: fetchImpl });
  const verify = (key, sha256) =>
    verifyPublicObject({
      url: `${base.origin}/${keyPath(key)}`,
      sha256,
      unreadable:
        "A published R2 object could not be read anonymously; stable promotion did not occur",
      fetch: fetchImpl,
      retryDelayMs,
    });

  // The bucket decides what a rerun still uploads: the version folder's lock
  // rule rejects any write to an existing object, even a create-only one. An
  // existing object must match before anything is uploaded, since an upload
  // into the locked folder can never be withdrawn.
  const missing = [];
  for (const file of files)
    if (await exists(versionKey(file.name)))
      await verify(versionKey(file.name), file.sha256);
    else missing.push(file);
  for (const file of missing)
    await put(
      versionKey(file.name),
      path.join(directory, file.name),
      file.sha256,
      {
        createOnly: true,
        cacheControl: IMMUTABLE,
      },
    );
  for (const file of missing) await verify(versionKey(file.name), file.sha256);
  if (preview) return;

  // Stable: recheck the feed, then replace it last so installed apps only ever
  // see a fully uploaded and verified release.
  await preflightR2({ distribution, version, feed, fetch: fetchImpl });
  const feedFile = path.join(directory, feed);
  const feedSha256 = createHash("sha256")
    .update(readFileSync(feedFile))
    .digest("hex");
  await put(`${prefix}/${feed}`, feedFile, feedSha256, {
    createOnly: false,
    cacheControl: "no-cache",
  });
  const published = await fetchFeed(fetchImpl, distribution, feed);
  if (
    !published ||
    createHash("sha256").update(published).digest("hex") !== feedSha256
  )
    throw new PublicationError(
      "The public R2 feed does not match this candidate's feed; inspect it before retrying",
    );
}
