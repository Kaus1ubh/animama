import { createHash, timingSafeEqual } from "node:crypto";

const RENDERER_CAPABILITY_COOKIE = "animama_renderer_capability";

export type RendererCapabilityPolicy = {
  value: string;
  cookieName?: string;
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return null;
}

/** Compare the Electron-only cookie without exposing either value to React. */
export function hasRendererCapability(
  cookieHeader: string | null,
  policy?: RendererCapabilityPolicy,
): boolean {
  if (!policy) return true;
  const received = readCookie(
    cookieHeader,
    policy.cookieName ?? RENDERER_CAPABILITY_COOKIE,
  );
  if (received === null) return false;
  return timingSafeEqual(digest(received), digest(policy.value));
}
