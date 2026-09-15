import { randomBytes } from "node:crypto";

import type { Session } from "electron";

export const ANIMAMA_SESSION_PARTITION = "persist:animama";
const RENDERER_CAPABILITY_COOKIE = "animama_renderer_capability";

/** Generate a fresh per-launch capability retained only by Electron main. */
export function createRendererCapability(): string {
  return randomBytes(32).toString("hex");
}

/** Install the host-only HttpOnly cookie before any renderer navigation. */
export async function installRendererCapability(
  targetSession: Session,
  applicationOrigin: string,
  capability: string,
): Promise<void> {
  const origin = new URL(applicationOrigin);
  await targetSession.cookies.set({
    url: `${origin.origin}/`,
    name: RENDERER_CAPABILITY_COOKIE,
    value: capability,
    httpOnly: true,
    secure: origin.protocol === "https:",
    sameSite: "strict",
    path: "/",
  });
}

/** Revoke only this launch's transient cookie, leaving owner data and the partition intact. */
export async function removeRendererCapability(
  targetSession: Session,
  applicationOrigin: string,
): Promise<void> {
  await targetSession.cookies.remove(
    `${new URL(applicationOrigin).origin}/`,
    RENDERER_CAPABILITY_COOKIE,
  );
}
