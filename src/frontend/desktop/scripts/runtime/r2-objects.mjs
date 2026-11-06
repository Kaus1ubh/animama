import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PublicationError } from "./publication.mjs";

/** Cache policy for objects that never change once published. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

const CONTENT_TYPES = [
  [".dmg", "application/x-apple-diskimage"],
  [".zip", "application/zip"],
  [".tar.zst", "application/zstd"],
  [".json", "application/json"],
  [".yml", "text/yaml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
];

/**
 * The bucket-scoped R2 API token, supplied only to publish commands. Values
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

/** An object key as a URL path, each segment encoded. */
export const keyPath = (key) =>
  key.split("/").map(encodeURIComponent).join("/");

/** Default bound for one request; large model files pass a scaled bound. */
const REQUEST_TIMEOUT_MS = 20 * 60_000;

/**
 * A request bound for transferring `size` bytes: the default plus one second
 * per 256 KiB, so a slow uplink can still move a 1.24 GB model once.
 */
export const transferTimeoutMs = (size) =>
  REQUEST_TIMEOUT_MS + Math.ceil(size / (256 * 1024)) * 1_000;

/** Anonymous GET through the public domain; transport errors become bounded failures. */
export async function publicGet(
  fetchImpl,
  url,
  { headers, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  try {
    return await fetchImpl(url, {
      ...(headers ? { headers } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PublicationError(
      "The public R2 domain could not be reached; check the custom domain before retrying",
    );
  }
}

/** Stream a body and return its SHA-256. */
export async function sha256Of(body) {
  const hash = createHash("sha256");
  for await (const chunk of body) hash.update(chunk);
  return hash.digest("hex");
}

const bucketEndpoint = (credentials, bucket) =>
  `https://${credentials.accountId}.r2.cloudflarestorage.com/${bucket}`;

/**
 * Whether the bucket already holds `key`, from a signed HEAD through R2's S3
 * API. Unlike the public domain, this is never stale, so an existing object is
 * never uploaded again.
 */
export function r2Exists({ bucket, credentials, fetch: fetchImpl = fetch }) {
  return async function exists(key) {
    const { AwsV4Signer } = await import("aws4fetch");
    const signed = await new AwsV4Signer({
      method: "HEAD",
      url: `${bucketEndpoint(credentials, bucket)}/${keyPath(key)}`,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      service: "s3",
      region: "auto",
    }).sign();
    let response;
    try {
      response = await fetchImpl(signed.url, {
        method: "HEAD",
        redirect: "error",
        headers: Object.fromEntries(signed.headers),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new PublicationError(
        "R2 could not be reached to check an object; retry when it is available",
      );
    }
    if (response.status === 404) return false;
    if (response.ok) return true;
    throw new PublicationError(
      `R2 refused an object check (${response.status}); check the token scope and bucket before retrying`,
    );
  };
}

/**
 * Signed PUTs to one bucket through R2's S3 API. `createOnly` sends
 * `If-None-Match: *`; a 412 (the object exists) is left to the caller's
 * anonymous verification. R2 rejects a body whose SHA-256 differs from the
 * signed value.
 */
export function r2Writer({ bucket, credentials, fetch: fetchImpl = fetch }) {
  const endpoint = bucketEndpoint(credentials, bucket);
  return async function put(
    key,
    file,
    sha256,
    { createOnly, cacheControl, timeoutMs = REQUEST_TIMEOUT_MS },
  ) {
    // Loaded here so GitHub publication needs no signing dependency.
    const { AwsV4Signer } = await import("aws4fetch");
    const name = path.basename(file);
    const signed = await new AwsV4Signer({
      method: "PUT",
      url: `${endpoint}/${keyPath(key)}`,
      headers: {
        "Content-Type":
          CONTENT_TYPES.find(([suffix]) => name.endsWith(suffix))?.[1] ??
          "application/octet-stream",
        "Cache-Control": cacheControl,
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      release();
      throw new PublicationError(
        "An R2 upload failed; retry to resume, since uploaded objects are kept and verified",
      );
    }
    if (!response.ok) release();
    if (!response.ok && !(createOnly && response.status === 412))
      throw new PublicationError(
        `An R2 upload was rejected (${response.status}); check the token scope and bucket before retrying`,
      );
  };
}

/**
 * Retries of an anonymous 404: 5 minutes at the default 5 s delay. Cloudflare
 * caches a 404 at the edge for 3 minutes, so a URL that anyone read before its
 * object existed can keep answering 404 that long after the upload.
 */
const MISSING_RETRIES = 60;

/**
 * Download an object anonymously from its exact public URL and compare its
 * SHA-256. A 404 may be a miss the edge cached before the upload, so it is
 * retried for longer than that cache lasts. `identity` additionally requires
 * the exact uncompressed bytes a pinned downloader will accept.
 */
export async function verifyPublicObject({
  url,
  sha256,
  size,
  identity = false,
  unreadable = "A published R2 object could not be read anonymously",
  fetch: fetchImpl = fetch,
  retryDelayMs = 5_000,
  timeoutMs,
}) {
  for (let attempt = 0; ; attempt++) {
    const response = await publicGet(fetchImpl, url, {
      headers: identity ? { "Accept-Encoding": "identity" } : undefined,
      timeoutMs,
    });
    if (response.ok) {
      const encoding = (response.headers.get("content-encoding") ?? "identity")
        .trim()
        .toLowerCase();
      if (
        identity &&
        (response.status !== 200 ||
          encoding !== "identity" ||
          response.headers.get("content-length") !== String(size))
      )
        throw new PublicationError(
          "A published R2 object is not served as exact uncompressed bytes; check the domain's compression and cache rules",
        );
      if ((await sha256Of(response.body)) !== sha256)
        throw new PublicationError(
          "A published R2 object differs from this candidate; review it manually. Objects are never replaced",
        );
      return;
    }
    if (response.status !== 404 || attempt >= MISSING_RETRIES)
      throw new PublicationError(unreadable);
    await sleep(retryDelayMs);
  }
}
