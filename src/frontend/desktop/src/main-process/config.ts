import { ANIMAMA_SESSION_PARTITION } from "./security/renderer-capability.js";

const DEFAULT_WEB_URL = "http://localhost:3000";
const DEFAULT_LOAD_TIMEOUT_MS = 15_000;
const ALLOWED_WEB_PROTOCOLS = new Set(["http:", "https:"]);

export type DesktopConfig = {
  allowedWebOrigin: string;
  loadTimeoutMs: number;
  sessionPartition: string;
  webUrl: URL;
};

export function resolveDesktopConfig(embeddedOrigin?: string): DesktopConfig {
  const webUrl = embeddedOrigin ? new URL(embeddedOrigin) : resolveWebUrl();

  return {
    allowedWebOrigin: webUrl.origin,
    loadTimeoutMs: resolveLoadTimeoutMs(),
    sessionPartition: ANIMAMA_SESSION_PARTITION,
    webUrl,
  };
}

function resolveWebUrl(): URL {
  const rawUrl = process.env.ANIMAMA_DESKTOP_WEB_URL?.trim() || DEFAULT_WEB_URL;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid ANIMAMA_DESKTOP_WEB_URL: expected an absolute http(s) URL, received "${rawUrl}"`,
    );
  }

  if (!ALLOWED_WEB_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `Invalid ANIMAMA_DESKTOP_WEB_URL protocol "${url.protocol}"; expected http: or https:`,
    );
  }

  return url;
}

function resolveLoadTimeoutMs(): number {
  const rawValue = process.env.ANIMAMA_DESKTOP_LOAD_TIMEOUT_MS?.trim();
  if (!rawValue) return DEFAULT_LOAD_TIMEOUT_MS;

  const parsedValue = Number(rawValue);
  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return parsedValue;
  }

  throw new Error(
    `Invalid ANIMAMA_DESKTOP_LOAD_TIMEOUT_MS: expected a positive number, received "${rawValue}"`,
  );
}
