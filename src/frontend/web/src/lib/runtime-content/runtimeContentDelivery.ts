import type { RuntimeCatalogEntry } from "./types";
import { runtimeContentEntryUrl } from "@/lib/runtime-content/animaRuntimeSnapshot";
import { normalizeBaseUrl } from "@/lib/utils";

type RuntimeContentFetch = typeof fetch;

/** Provide URL-only glTF decoders with the already verified model/animation closure. */
export function preparedRuntimeResourceUrls(
  entry: RuntimeCatalogEntry | null,
): Readonly<Record<string, string>> | undefined {
  if (entry?.source.type !== "prepared_files") return undefined;
  return {
    ...Object.fromEntries(
      entry.source.files.map((file) => [file.filename, file.url]),
    ),
    ...entry.source.logical_resource_urls,
  };
}

/** Read one JSON response without allowing streaming bodies to exceed a cap. */
export async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel(
      "Runtime content manifest exceeds the byte limit",
    );
    throw new Error("Runtime content manifest exceeds the byte limit");
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error("Runtime content manifest exceeds the byte limit");
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel("Runtime content manifest exceeds the byte limit");
      throw new Error("Runtime content manifest exceeds the byte limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Return whether a resolved entry must be fetched through the private gateway. */
export function runtimeContentRequiresPrivateFetch(
  entry: RuntimeCatalogEntry | null | undefined,
): boolean {
  return entry?.source.type === "authorized_files";
}

/** Resolve one API-relative authorized resource without changing absolute URLs. */
export function resolvePrivateRuntimeContentUrl(
  url: string,
  apiBaseUrl: string,
): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return url;
  return new URL(url, `${normalizeBaseUrl(apiBaseUrl)}/`).href;
}

/**
 * Resolve an entry to the URL the browser should actually request.
 *
 * App resources remain relative to the web application. Owner-authorized user
 * resources are relative to FastAPI, so they must use the same configured API
 * origin as the generated client before requesting a protected byte URL.
 */
export function runtimeContentDeliveryUrl(
  entry: RuntimeCatalogEntry | null | undefined,
): string | null {
  const url = runtimeContentEntryUrl(entry);
  return url ? resolveRuntimeContentDeliveryReference(entry, url) : url;
}

/** Resolve any selected file URL from a private runtime entry to FastAPI. */
export function resolveRuntimeContentDeliveryReference(
  entry: RuntimeCatalogEntry | null | undefined,
  url: string,
  apiBaseUrl: string | null = typeof window !== "undefined"
    ? window.location.origin
    : null,
): string {
  if (!runtimeContentRequiresPrivateFetch(entry)) return url;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return url;
  return apiBaseUrl ? resolvePrivateRuntimeContentUrl(url, apiBaseUrl) : url;
}

/** Fetch one protected byte through the application origin with redirects disabled. */
export function fetchProtectedContentResponse(
  contentUrl: string,
  options: {
    headers?: HeadersInit;
    fetcher?: RuntimeContentFetch;
    signal?: AbortSignal;
  },
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const isAbsolute = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(contentUrl);
  const apiBaseUrl =
    typeof window !== "undefined" ? window.location.origin : "";
  const resolved =
    !isAbsolute && apiBaseUrl
      ? resolvePrivateRuntimeContentUrl(contentUrl, apiBaseUrl)
      : contentUrl;
  const headers = new Headers(options.headers);
  // Local identity is resolved by FastAPI after admission; browser-provided credentials are never forwarded.
  headers.delete("authorization");
  return fetcher(resolved, {
    cache: "no-cache",
    credentials: "same-origin",
    headers,
    redirect: "error",
    signal: options.signal,
  });
}

/**
 * A decoder URL and its lifetime. Release after consumption (including failure).
 * Public and prepared URLs are borrowed; their release does not revoke them.
 */
export type RuntimeContentUrlLease = {
  url: string;
  release: () => void;
};

/** Acquire protected bytes for URL-only decoders, retaining explicit ownership. */
export async function runtimeContentDownloadUrl(
  entry: RuntimeCatalogEntry,
  logicalUrl = runtimeContentDeliveryUrl(entry),
  options: {
    fetcher?: RuntimeContentFetch;
    signal?: AbortSignal;
  } = {},
): Promise<RuntimeContentUrlLease | null> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (!logicalUrl) return null;
  if (!runtimeContentRequiresPrivateFetch(entry)) {
    return { url: logicalUrl, release: () => {} };
  }
  const response = await fetchPrivateRuntimeContentResponse(
    entry,
    logicalUrl,
    options,
  );
  if (!response.ok) {
    throw new Error(
      `Runtime content fetch failed with HTTP ${response.status}`,
    );
  }
  signal?.throwIfAborted();
  const blob = await response.blob();
  // Body readers and injected fetchers may finish despite cancellation.
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal?.removeEventListener("abort", release);
    URL.revokeObjectURL(url);
  };
  signal?.addEventListener("abort", release, { once: true });
  return { url, release };
}

/** Fetch one private runtime file through the same-origin application boundary. */
export async function fetchPrivateRuntimeContentResponse(
  entry: RuntimeCatalogEntry,
  logicalUrl: string,
  options: {
    fetcher?: RuntimeContentFetch;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  if (!runtimeContentRequiresPrivateFetch(entry)) {
    const resolved = resolveRuntimeContentDeliveryReference(entry, logicalUrl);
    return fetcher(resolved, {
      cache: "no-cache",
      credentials: "same-origin",
      redirect: "error",
      signal: options.signal,
    });
  }
  const resolved = resolveRuntimeContentDeliveryReference(entry, logicalUrl);
  return fetchProtectedContentResponse(resolved, {
    fetcher,
    signal: options.signal,
  });
}

/** Fetch a private image through the same-origin application boundary. */
export async function fetchPrivateRuntimeContentBlob(
  entry: RuntimeCatalogEntry,
  url: string,
): Promise<Blob> {
  const response = await fetchPrivateRuntimeContentResponse(entry, url);
  if (!response.ok) {
    throw new Error(
      `Runtime content fetch failed with HTTP ${response.status}`,
    );
  }
  return response.blob();
}
