import type { CSSProperties } from "react";

export type AppShellSidebarBehavior = "inset" | "adaptive-canvas";

export type AppShellSidebarLayoutStyle = CSSProperties & {
  "--app-shell-sidebar-inset": string;
};

export const EXPANDED_SIDEBAR_WIDTH = 242;
// The compact wrapper is 88px wide, but its visible controls end at 56px.
export const COLLAPSED_SIDEBAR_CONTROL_INSET = 56;

type ResolveAppShellSidebarLayoutInput = {
  behavior: AppShellSidebarBehavior;
  isDesktop: boolean;
  sidebarOpen: boolean;
};

/**
 * Resolve page geometry and the remaining local control-safe inset.
 *
 * Adaptive Canvas surfaces dock beside an expanded desktop sidebar, so their
 * children need no second inset. When collapsed, the surface returns to the
 * full viewport and only floating controls avoid the compact icon rail.
 */
export function resolveAppShellSidebarLayout({
  behavior,
  isDesktop,
  sidebarOpen,
}: ResolveAppShellSidebarLayoutInput): AppShellSidebarLayoutStyle {
  const sidebarWidth = isDesktop
    ? sidebarOpen
      ? EXPANDED_SIDEBAR_WIDTH
      : COLLAPSED_SIDEBAR_CONTROL_INSET
    : 0;
  const surfaceInset =
    isDesktop && behavior === "adaptive-canvas" && !sidebarOpen
      ? 0
      : sidebarWidth;
  const controlInset =
    isDesktop && behavior === "adaptive-canvas" && sidebarOpen
      ? 0
      : sidebarWidth;

  return {
    "--app-shell-sidebar-inset": `${controlInset}px`,
    // Keep both endpoints numeric. Omitting zero-valued geometry falls back to
    // `width: auto`, which cannot interpolate to the expanded calculated width
    // and makes right-anchored Canvas chrome jump during sidebar transitions.
    marginLeft: `${surfaceInset}px`,
    width: `calc(100% - ${surfaceInset}px)`,
  };
}
