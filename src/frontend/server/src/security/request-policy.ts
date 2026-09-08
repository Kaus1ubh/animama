import type { Context } from "hono";

import {
  hasRendererCapability,
  type RendererCapabilityPolicy,
} from "./renderer-capability.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type LocalRequestPolicy = {
  publicOrigin: URL;
  allowSameSiteFetches?: boolean;
  rendererCapability?: RendererCapabilityPolicy;
};

export type PolicyFailure = {
  status: 401 | 403 | 421;
};

function hostMatches(actual: string | null, expected: string): boolean {
  return actual?.trim().toLowerCase() === expected.toLowerCase();
}

function originMatches(actual: string | null, expected: string): boolean {
  return actual === null || actual === expected;
}

function fetchSiteAllowed(
  value: string | null,
  policy: LocalRequestPolicy,
): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return (
    normalized === "same-origin" ||
    normalized === "none" ||
    (normalized === "same-site" && policy.allowSameSiteFetches === true)
  );
}

/** Apply browser admission checks before any application request is handled. */
export function validateHttpRequest(
  request: Request,
  policy: LocalRequestPolicy,
  options: { requireCsrf: boolean },
): PolicyFailure | null {
  if (!hostMatches(request.headers.get("host"), policy.publicOrigin.host)) {
    return { status: 421 };
  }
  if (
    !originMatches(request.headers.get("origin"), policy.publicOrigin.origin)
  ) {
    return { status: 403 };
  }
  if (!fetchSiteAllowed(request.headers.get("sec-fetch-site"), policy)) {
    return { status: 403 };
  }
  if (policy.rendererCapability) {
    const site = request.headers.get("sec-fetch-site");
    // Electron always supplies Fetch Metadata. Unlike operator CLI requests,
    // renderer mutations must also carry the browser's exact Origin.
    if (
      !request.headers.has("origin") &&
      (!SAFE_METHODS.has(request.method.toUpperCase()) ||
        !["none", "same-origin"].includes(site ?? ""))
    ) {
      return { status: 403 };
    }
  }
  if (
    !hasRendererCapability(
      request.headers.get("cookie"),
      policy.rendererCapability,
    )
  ) {
    return { status: 401 };
  }

  if (options.requireCsrf && !SAFE_METHODS.has(request.method.toUpperCase())) {
    if (request.headers.get("x-animama-csrf") !== "1") {
      return { status: 403 };
    }
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site")?.toLowerCase();
    if (origin === null) {
      if (site !== "none") return { status: 403 };
    } else {
      if (origin !== policy.publicOrigin.origin) return { status: 403 };
      if (
        site !== "same-origin" &&
        !(site === "same-site" && policy.allowSameSiteFetches === true)
      ) {
        return { status: 403 };
      }
    }
  }
  return null;
}

/** WebSocket upgrades always require the exact public Origin. */
export function validateWebSocketRequest(
  request: import("node:http").IncomingMessage,
  policy: LocalRequestPolicy,
): PolicyFailure | null {
  const host = request.headers.host ?? null;
  const origin = Array.isArray(request.headers.origin)
    ? request.headers.origin[0]
    : (request.headers.origin ?? null);
  const fetchSite = Array.isArray(request.headers["sec-fetch-site"])
    ? request.headers["sec-fetch-site"][0]
    : (request.headers["sec-fetch-site"] ?? null);
  const cookie = Array.isArray(request.headers.cookie)
    ? request.headers.cookie.join("; ")
    : (request.headers.cookie ?? null);

  if (!hostMatches(host, policy.publicOrigin.host)) return { status: 421 };
  if (origin !== policy.publicOrigin.origin) return { status: 403 };
  if (!fetchSiteAllowed(fetchSite, policy)) return { status: 403 };
  if (!hasRendererCapability(cookie, policy.rendererCapability)) {
    return { status: 401 };
  }
  return null;
}

/** Return the same bounded response for every policy failure. */
export function rejectByPolicy(c: Context, failure: PolicyFailure): Response {
  return c.json({ error: "gateway_request_rejected" }, failure.status);
}
