import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PublicationError } from "./publication.mjs";
import {
  IMMUTABLE,
  keyPath,
  publicGet,
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

/** The public stable feed's bytes, bypassing caches, or null before the first release. */
async function fetchFeed(fetchImpl, distribution) {
  const response = await publicGet(
    fetchImpl,
    `${distribution.base_url}/latest-mac.yml?noCache=${randomBytes(6).toString("hex")}`,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new PublicationError(
      "The public R2 domain did not serve the release feed; check the custom domain before retrying",
    );
  return Buffer.from(await response.arrayBuffer());
}

/** The version the public stable feed currently names, or null for an empty bucket. */
async function publishedVersion(fetchImpl, distribution) {
  const feed = await fetchFeed(fetchImpl, distribution);
  if (!feed) return null;
  const version = /^version:\s*['"]?([^'"\s]+)/mu.exec(
    feed.toString("utf8"),
  )?.[1];
  if (!version || !VERSION.test(version))
    throw new PublicationError(
      "The public R2 feed is unreadable; inspect it before publishing",
    );
  return version;
}

/**
 * Before reading credentials or preparing reports: the public domain must
 * answer, and this version must be newer than the published stable feed.
 */
export async function preflightR2({
  distribution,
  version,
  fetch: fetchImpl = fetch,
}) {
  const current = await publishedVersion(fetchImpl, distribution);
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
 * Publish to R2: create-only uploads into `<base>/v<version>/`, anonymous
 * verification of every object, and, for stable promotion only, the root
 * `latest-mac.yml` written last. Nothing is overwritten except that feed, so
 * an interrupted run leaves the previous stable release in place and resumes
 * with byte-identical objects.
 */
export async function publishR2({
  distribution,
  bucket,
  version,
  directory,
  files,
  preview,
  credentials,
  fetch: fetchImpl = fetch,
  retryDelayMs = 5_000,
}) {
  const base = new URL(distribution.base_url);
  const prefix = base.pathname.slice(1);
  const versionKey = (name) => `${prefix}/v${version}/${name}`;
  const put = r2Writer({ bucket, credentials, fetch: fetchImpl });
  const verify = (key, sha256) =>
    verifyPublicObject({
      url: `${base.origin}/${keyPath(key)}`,
      sha256,
      unreadable:
        "A published R2 object could not be read anonymously; stable promotion did not occur",
      fetch: fetchImpl,
      retryDelayMs,
    });

  for (const file of files)
    await put(
      versionKey(file.name),
      path.join(directory, file.name),
      file.sha256,
      {
        createOnly: true,
        cacheControl: IMMUTABLE,
      },
    );
  for (const file of files) await verify(versionKey(file.name), file.sha256);
  if (preview) return;

  // Stable: recheck the feed, then replace it last so installed apps only ever
  // see a fully uploaded and verified release.
  await preflightR2({ distribution, version, fetch: fetchImpl });
  const feed = path.join(directory, "latest-mac.yml");
  const feedSha256 = createHash("sha256")
    .update(readFileSync(feed))
    .digest("hex");
  await put(`${prefix}/latest-mac.yml`, feed, feedSha256, {
    createOnly: false,
    cacheControl: "no-cache",
  });
  const published = await fetchFeed(fetchImpl, distribution);
  if (
    !published ||
    createHash("sha256").update(published).digest("hex") !== feedSha256
  )
    throw new PublicationError(
      "The public R2 feed does not match this candidate's feed; inspect it before retrying",
    );
}
