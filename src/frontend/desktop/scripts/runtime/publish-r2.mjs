import { createHash, randomBytes } from "node:crypto";
import { createReadStream, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PublicationError } from "./publication.mjs";

const IMMUTABLE = "public, max-age=31536000, immutable";
const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/u;
const CONTENT_TYPES = [
  [".dmg", "application/x-apple-diskimage"],
  [".zip", "application/zip"],
  [".tar.zst", "application/zstd"],
  [".json", "application/json"],
  [".yml", "text/yaml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
];

/**
 * The bucket-scoped R2 API token, supplied only to the publish command. Values
 * are never included in messages.
 */
export function r2Credentials(env = process.env) {
  const accountId = env.ANIMAMA_R2_ACCOUNT_ID ?? "";
  const accessKeyId = env.ANIMAMA_R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = env.ANIMAMA_R2_SECRET_ACCESS_KEY ?? "";
  if (!/^[a-f0-9]{32}$/u.test(accountId) || !accessKeyId || !secretAccessKey)
    throw new PublicationError(
      "Set ANIMAMA_R2_ACCOUNT_ID, ANIMAMA_R2_ACCESS_KEY_ID and ANIMAMA_R2_SECRET_ACCESS_KEY for the bucket-scoped R2 token; they are never packaged",
    );
  return { accountId, accessKeyId, secretAccessKey };
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

/** Anonymous GET through the public domain; transport errors become bounded failures. */
async function publicGet(fetchImpl, url) {
  try {
    return await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20 * 60_000),
    });
  } catch {
    throw new PublicationError(
      "The public R2 domain could not be reached; check the custom domain before retrying",
    );
  }
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

/** Stream a file and return its SHA-256, or a bounded failure. */
async function sha256Of(body) {
  const hash = createHash("sha256");
  for await (const chunk of body) hash.update(chunk);
  return hash.digest("hex");
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
  // Loaded here so GitHub publication needs no signing dependency.
  const { AwsV4Signer } = await import("aws4fetch");
  const base = new URL(distribution.base_url);
  const prefix = base.pathname.slice(1);
  const endpoint = `https://${credentials.accountId}.r2.cloudflarestorage.com/${bucket}`;
  const versionKey = (name) => `${prefix}/v${version}/${name}`;

  const put = async (key, file, sha256, { createOnly, cacheControl }) => {
    const name = path.basename(file);
    const signed = await new AwsV4Signer({
      method: "PUT",
      url: `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`,
      headers: {
        "Content-Type":
          CONTENT_TYPES.find(([suffix]) => name.endsWith(suffix))?.[1] ??
          "application/octet-stream",
        "Cache-Control": cacheControl,
        // R2 rejects a body whose SHA-256 differs from this signed value.
        "X-Amz-Content-Sha256": sha256,
        ...(createOnly ? { "If-None-Match": "*" } : {}),
      },
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      service: "s3",
      region: "auto",
    }).sign();
    const body = createReadStream(file);
    // A failed or rejected request may never read the file; close it quietly.
    const release = () => {
      body.on("error", () => {});
      body.destroy();
    };
    let response;
    try {
      response = await fetchImpl(signed.url, {
        method: "PUT",
        redirect: "error",
        headers: {
          ...Object.fromEntries(signed.headers),
          "Content-Length": String(lstatSync(file).size),
        },
        body,
        duplex: "half",
        signal: AbortSignal.timeout(20 * 60_000),
      });
    } catch {
      release();
      throw new PublicationError(
        "An R2 upload failed; retry to resume, since uploaded objects are kept and verified",
      );
    }
    // 412: the object already exists; the anonymous verification decides if it matches.
    if (!response.ok) release();
    if (!response.ok && !(createOnly && response.status === 412))
      throw new PublicationError(
        `An R2 upload was rejected (${response.status}); check the token scope and bucket before retrying`,
      );
  };

  /** Download through the public domain and compare with the expected bytes. */
  const verify = async (key, sha256) => {
    for (let attempt = 0; ; attempt++) {
      const response = await publicGet(
        fetchImpl,
        `${base.origin}/${key.split("/").map(encodeURIComponent).join("/")}`,
      );
      if (response.ok) {
        if ((await sha256Of(response.body)) !== sha256)
          throw new PublicationError(
            "A published R2 object differs from this candidate; review it manually. Objects are never replaced",
          );
        return;
      }
      // A fresh object can take a moment to reach the public domain.
      if (response.status !== 404 || attempt >= 3)
        throw new PublicationError(
          "A published R2 object could not be read anonymously; stable promotion did not occur",
        );
      await sleep(retryDelayMs);
    }
  };

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
