import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy `/a` and `/a/...` URLs from before the app moved to top-level paths.
 * Redirect to the same path without the prefix, keeping search and hash.
 */
export const Route = createFileRoute("/a")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: legacyApplicationHref(location.href),
      replace: true,
    });
  },
});

/** Strip the `/a` prefix; collapse leading slashes so the result stays on-origin. */
export function legacyApplicationHref(href: string): string {
  const url = new URL(href, "http://legacy.invalid");
  const rest = url.pathname.replace(/^\/a(?=\/|$)/i, "").replace(/^\/+/, "");
  return `/${rest}${url.search}${url.hash}`;
}
