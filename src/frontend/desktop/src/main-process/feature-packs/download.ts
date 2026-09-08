import { constants } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { atomicWrite } from "../runtime/atomic-file.js";
import { RuntimeError } from "../runtime/errors.js";
import { downloadUrl, readBoundedJson, type PackManifest } from "./catalog.js";
import { hashFile } from "./files.js";

function strongEtag(value: unknown): value is string {
  return typeof value === "string" && /^"[\x21\x23-\x7e]{1,510}"$/u.test(value);
}
async function responseFor(
  url: URL,
  development: boolean,
  headers: Record<string, string>,
  signal: AbortSignal,
  redirects = 0,
): Promise<IncomingMessage> {
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      { headers, signal },
      resolve,
    );
    request.on("error", (error) =>
      reject(
        error instanceof RuntimeError
          ? error
          : new RuntimeError("pack_download_failed"),
      ),
    );
    request.setTimeout(30_000, () =>
      request.destroy(new RuntimeError("pack_download_timeout")),
    );
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    response.destroy();
    if (redirects >= 5 || !response.headers.location)
      throw new RuntimeError("pack_download_redirect");
    return responseFor(
      downloadUrl(
        new URL(response.headers.location, url).href,
        development,
        true,
      ),
      development,
      headers,
      signal,
      redirects + 1,
    );
  }
  return response;
}

/** Resume only a catalog-matched partial for which a server proves exact ETag/range identity. */
export async function downloadPack(options: {
  manifest: PackManifest;
  partial: string;
  development: boolean;
  signal: AbortSignal;
  progress(bytes: number): void;
}): Promise<void> {
  const { manifest, partial, signal, progress } = options;
  const metadataFile = `${partial}.json`;
  let offset = 0;
  let etag: string | undefined;
  try {
    const metadata = await lstat(partial);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      throw new RuntimeError("pack_path_invalid");
    const saved = (await readBoundedJson(metadataFile, 4096)) as Record<
      string,
      unknown
    >;
    if (
      saved.sha256 === manifest.archive_sha256 &&
      saved.url === manifest.url &&
      strongEtag(saved.etag) &&
      metadata.size < manifest.archive_bytes
    ) {
      offset = metadata.size;
      etag = saved.etag;
    }
  } catch (error) {
    if (error instanceof RuntimeError && error.code === "pack_path_invalid")
      throw error;
    // A partial without validated resume metadata has no reuse authority.
  }
  signal.throwIfAborted();
  const url = downloadUrl(manifest.url, options.development);
  let response = await responseFor(
    url,
    options.development,
    {
      "Accept-Encoding": "identity",
      ...(offset && etag
        ? { Range: `bytes=${offset}-`, "If-Range": etag }
        : {}),
    },
    signal,
  );
  const validRange =
    response.statusCode === 206 &&
    response.headers.etag === etag &&
    response.headers["content-length"] ===
      String(manifest.archive_bytes - offset) &&
    (!response.headers["content-encoding"] ||
      response.headers["content-encoding"] === "identity") &&
    response.headers["content-range"] ===
      `bytes ${offset}-${manifest.archive_bytes - 1}/${manifest.archive_bytes}`;
  if (offset && !validRange) {
    response.destroy();
    offset = 0;
    response = await responseFor(
      url,
      options.development,
      { "Accept-Encoding": "identity" },
      signal,
    );
  }
  const expected = manifest.archive_bytes - offset;
  if (
    response.statusCode !== (offset ? 206 : 200) ||
    response.headers["content-length"] !== String(expected) ||
    (response.headers["content-encoding"] &&
      response.headers["content-encoding"] !== "identity")
  ) {
    response.destroy();
    throw new RuntimeError("pack_download_length_invalid");
  }
  const handle = await open(
    partial,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      (offset ? constants.O_APPEND : constants.O_TRUNC),
    0o600,
  ).catch((error) => {
    response.destroy();
    throw error;
  });
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (offset && metadata.size !== offset)
    )
      throw new RuntimeError("pack_path_invalid");
    if (strongEtag(response.headers.etag))
      atomicWrite(
        metadataFile,
        JSON.stringify({
          sha256: manifest.archive_sha256,
          url: manifest.url,
          etag: response.headers.etag,
        }),
      );
    else await rm(metadataFile, { force: true });
    let transferred = offset;
    for await (const chunk of response) {
      signal.throwIfAborted();
      transferred += chunk.length;
      if (transferred > manifest.archive_bytes)
        throw new RuntimeError("pack_download_length_invalid");
      await handle.writeFile(chunk);
      progress(transferred);
    }
    if (transferred !== manifest.archive_bytes)
      throw new RuntimeError("pack_download_length_invalid");
    await handle.sync();
  } catch (error) {
    // A closed network stream is a retryable pack failure, not a failure to
    // start the local runtime. The manager still gives cancellation priority.
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError("pack_download_failed");
  } finally {
    response.destroy();
    await handle.close();
  }
  if ((await hashFile(partial, signal)) !== manifest.archive_sha256) {
    await rm(partial, { force: true });
    await rm(metadataFile, { force: true });
    throw new RuntimeError("pack_archive_hash_invalid");
  }
}
