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
  gatewayOrigin: string,
  capability: string,
): Promise<void> {
  const origin = new URL(gatewayOrigin);
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
