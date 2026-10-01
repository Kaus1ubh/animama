import type { BrowserWindow, Session } from "electron";

import { removeRendererCapability } from "../security/renderer-capability.js";

/**
 * First path segments that are never main-window app routes: backend APIs,
 * private and static mounts, the safety page and desktop-only windows.
 */
const NON_APPLICATION_SEGMENTS = new Set([
  "_desktop",
  "api",
  "v1",
  "docs",
  "redoc",
  "openapi.json",
  "onnx",
  "tts",
  "basis",
  "assets",
  "content",
  "background",
  "effects",
  "desktop",
  "safety",
  "health",
]);

/** Retain only an actual main-app route, never credentials, controls or another origin. */
export function validatedApplicationRoute(
  value: string,
  origin: string,
): string | null {
  try {
    if (value.length > 4096 || /[\x00-\x20\x7f\\]/u.test(value)) return null;
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      /[\x00-\x1f\x7f\\]/u.test(pathname) ||
      pathname.split("/").some((part) => part === "." || part === "..") ||
      !pathname.startsWith("/") ||
      // An empty first segment ("//host/...") would resolve to another origin.
      pathname.startsWith("//") ||
      // Router matching is case-insensitive, so compare segments the same way.
      NON_APPLICATION_SEGMENTS.has(pathname.split("/")[1]!.toLowerCase())
    )
      return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Destroy documents synchronously so dedicated/shared workers cannot outlive a transition. */
export function destroyProductWindows(
  windows: BrowserWindow[],
  main: BrowserWindow | undefined,
  recovery: BrowserWindow | undefined,
  origin: string | undefined,
): string | null {
  let route: string | null = null;
  try {
    if (main && !main.isDestroyed() && origin)
      route = validatedApplicationRoute(main.webContents.getURL(), origin);
  } catch {
    /* A crashed document must not prevent the remaining windows from closing. */
  }
  for (const window of windows)
    if (window !== recovery && !window.isDestroyed()) window.destroy();
  return route;
}

/** Close only transient app authority/workers; keep the partition and durable browser storage. */
export async function closeProductSession(
  target: Session,
  origin: string,
): Promise<void> {
  const failures: unknown[] = [];
  for (const cleanup of [
    () => removeRendererCapability(target, origin),
    () => target.clearStorageData({ origin, storages: ["serviceworkers"] }),
    () => target.closeAllConnections(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "renderer_cleanup_failed");
}

/** Retry failed cleanup without reopening admission or losing a racing cookie write. */
export class ProductSessionCleanup {
  private activeGeneration = 0;
  private cleanedGeneration = 0;
  private pending = 0;
  private failed = false;
  private work: Promise<void> = Promise.resolve();

  constructor(private cleanup: () => Promise<void>) {}

  markActive(): void {
    this.activeGeneration++;
  }

  get blocked(): boolean {
    return this.pending > 0 || this.failed;
  }

  close(): Promise<void> {
    this.pending++;
    const next = this.work
      .catch(() => undefined)
      .then(async () => {
        try {
          while (this.cleanedGeneration !== this.activeGeneration) {
            const generation = this.activeGeneration;
            await this.cleanup();
            this.cleanedGeneration = generation;
          }
          this.failed = false;
        } catch (error) {
          this.failed = true;
          throw error;
        } finally {
          this.pending--;
        }
      });
    this.work = next;
    return next;
  }
}

/** A stopped or replaced listener must never receive a retained renderer capability. */
export function installProductRequestGate(
  target: Session,
  origin: string,
  isReady: () => boolean,
): void {
  target.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      let product = false;
      try {
        const url = new URL(details.url);
        if (url.protocol === "ws:") url.protocol = "http:";
        else if (url.protocol === "wss:") url.protocol = "https:";
        product = url.origin === origin;
      } catch {
        /* Other URL schemes retain their existing session policy. */
      }
      callback({ cancel: product && !isReady() });
    },
  );
}
