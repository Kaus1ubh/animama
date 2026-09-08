import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type BrowserResourceLoadSource =
  | "network"
  | "browser_cache"
  | "network_revalidated"
  | "unknown";

export type BrowserResourceLoadInsight = {
  url: string;
  source: BrowserResourceLoadSource;
  reason: string;
  transferSize: number | null;
  encodedBodySize: number | null;
  decodedBodySize: number | null;
  durationMs: number | null;
  responseStatus: number | null;
  initiatorType: string | null;
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

export function joinUrlPath(base: string, path: string): string {
  const normalizedBase = normalizeBaseUrl(base);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

export function toAbsoluteBrowserResourceUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

export function redactUrlForLogging(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
    const parsed = isAbsolute
      ? new URL(trimmed)
      : new URL(trimmed, "http://anima.local");
    const origin = isAbsolute ? `${parsed.protocol}//${parsed.host}` : "";
    const querySuffix = parsed.search ? "?<redacted>" : "";
    return `${origin}${parsed.pathname}${querySuffix}${parsed.hash}`;
  } catch {
    const hashIndex = trimmed.indexOf("#");
    const queryIndex = trimmed.indexOf("?");
    const path = queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed;
    const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : "";
    return `${path}${queryIndex >= 0 ? "?<redacted>" : ""}${hash}`;
  }
}

export function getLatestBrowserResourceTimingEntry(
  url: string,
): PerformanceResourceTiming | null {
  if (typeof performance === "undefined") return null;
  const absoluteUrl = toAbsoluteBrowserResourceUrl(url);
  const entries = performance.getEntriesByName(absoluteUrl);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry instanceof PerformanceResourceTiming) {
      return entry;
    }
  }
  return null;
}

export function inspectBrowserResourceLoad(
  url: string,
): BrowserResourceLoadInsight {
  const absoluteUrl = toAbsoluteBrowserResourceUrl(url);
  const entry = getLatestBrowserResourceTimingEntry(url);
  if (!entry) {
    return {
      url: absoluteUrl,
      source: "unknown",
      reason: "resource_timing_unavailable",
      transferSize: null,
      encodedBodySize: null,
      decodedBodySize: null,
      durationMs: null,
      responseStatus: null,
      initiatorType: null,
    };
  }

  const transferSize =
    typeof entry.transferSize === "number" ? entry.transferSize : null;
  const encodedBodySize =
    typeof entry.encodedBodySize === "number" ? entry.encodedBodySize : null;
  const decodedBodySize =
    typeof entry.decodedBodySize === "number" ? entry.decodedBodySize : null;
  const durationMs = typeof entry.duration === "number" ? entry.duration : null;
  const responseStatus =
    typeof entry.responseStatus === "number" ? entry.responseStatus : null;
  const initiatorType =
    typeof entry.initiatorType === "string" ? entry.initiatorType : null;

  if (responseStatus === 304) {
    return {
      url: absoluteUrl,
      source: "network_revalidated",
      reason: "http_304_revalidation",
      transferSize,
      encodedBodySize,
      decodedBodySize,
      durationMs,
      responseStatus,
      initiatorType,
    };
  }

  if (transferSize !== null && transferSize > 0) {
    return {
      url: absoluteUrl,
      source: "network",
      reason: "nonzero_transfer_size",
      transferSize,
      encodedBodySize,
      decodedBodySize,
      durationMs,
      responseStatus,
      initiatorType,
    };
  }

  if (
    transferSize === 0 &&
    ((encodedBodySize !== null && encodedBodySize > 0) ||
      (decodedBodySize !== null && decodedBodySize > 0))
  ) {
    return {
      url: absoluteUrl,
      source: "browser_cache",
      reason: "zero_transfer_with_body_size",
      transferSize,
      encodedBodySize,
      decodedBodySize,
      durationMs,
      responseStatus,
      initiatorType,
    };
  }

  return {
    url: absoluteUrl,
    source: "unknown",
    reason: "insufficient_resource_timing_signal",
    transferSize,
    encodedBodySize,
    decodedBodySize,
    durationMs,
    responseStatus,
    initiatorType,
  };
}
