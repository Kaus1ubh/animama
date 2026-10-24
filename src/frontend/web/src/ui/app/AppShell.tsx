"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { cn } from "@/lib/utils";

type AppShellContextValue = {
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  isDesktop: boolean;
  suppressAnimations: boolean;
  sidebarAnimating: boolean;
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export const useOptionalAppShell = () => {
  return useContext(AppShellContext);
};

type AppShellProps = {
  children?: ReactNode;
  className?: string;
};

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";
const XL_MEDIA_QUERY = "(min-width: 1280px)";

/** Read a media query on first render, so the shell starts in its real mode. */
function matchesMedia(query: string): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(query).matches;
}

export function AppShell({ children, className }: AppShellProps) {
  // Starting from the viewport avoids a first frame laid out for a wide
  // window, which would slide every narrow page in from the sidebar inset.
  const [isDesktop, setIsDesktop] = useState(() =>
    matchesMedia(DESKTOP_MEDIA_QUERY),
  );
  // Only the md–xl rail starts collapsed; a phone session that widens to xl
  // still finds the sidebar expanded.
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(
    () => matchesMedia(XL_MEDIA_QUERY) || !matchesMedia(DESKTOP_MEDIA_QUERY),
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [suppressAnimations, setSuppressAnimations] = useState(false);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  const isDesktopRef = useRef(isDesktop);
  const desktopSidebarOpenRef = useRef(desktopSidebarOpen);
  const suppressTimerRef = useRef<number | null>(null);
  const animationTimerRef = useRef<number | null>(null);
  const sidebarOpen = isDesktop ? desktopSidebarOpen : mobileSidebarOpen;

  const suppressSidebarAnimations = () => {
    setSuppressAnimations(true);
    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => {
      setSuppressAnimations(false);
      suppressTimerRef.current = null;
    }, 0);
  };

  const beginSidebarAnimation = () => {
    setSidebarAnimating(true);
    if (animationTimerRef.current) {
      window.clearTimeout(animationTimerRef.current);
    }
    animationTimerRef.current = window.setTimeout(() => {
      setSidebarAnimating(false);
      animationTimerRef.current = null;
    }, 200);
  };

  const setSidebarOpen: Dispatch<SetStateAction<boolean>> = (value) => {
    beginSidebarAnimation();
    if (isDesktop) {
      setDesktopSidebarOpen((prev) =>
        typeof value === "function" ? value(prev) : value,
      );
    } else {
      setMobileSidebarOpen((prev) =>
        typeof value === "function" ? value(prev) : value,
      );
    }
  };

  const value: AppShellContextValue = {
    sidebarOpen,
    setSidebarOpen,
    openSidebar: () => setSidebarOpen(true),
    closeSidebar: () => setSidebarOpen(false),
    toggleSidebar: () => setSidebarOpen((prev) => !prev),
    isDesktop,
    suppressAnimations,
    sidebarAnimating,
  };

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  // The mobile drawer covers the page, so following one of its links closes it.
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    isDesktopRef.current = isDesktop;
  }, [isDesktop]);

  useEffect(() => {
    desktopSidebarOpenRef.current = desktopSidebarOpen;
  }, [desktopSidebarOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktopMedia = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const xlMedia = window.matchMedia(XL_MEDIA_QUERY);
    let previousDesktopMatches = desktopMedia.matches;
    let previousWidth = window.innerWidth;

    /**
     * Below `xl` an expanded sidebar overlaps the centred chat composer, so it
     * starts collapsed there and collapses whenever the window narrows. A
     * sidebar the user expands below `xl` stays open until the window shrinks;
     * below `md` it becomes the mobile drawer.
     */
    const syncForViewport = (isInitialSync = false) => {
      const nextIsDesktop = desktopMedia.matches;
      const nextIsXl = xlMedia.matches;
      const nextWidth = window.innerWidth;
      const currentIsDesktop = isDesktopRef.current;
      const currentDesktopSidebarOpen = desktopSidebarOpenRef.current;
      const viewportModeChanged = currentIsDesktop !== nextIsDesktop;
      const shouldCollapseDesktopSidebar =
        currentDesktopSidebarOpen &&
        nextIsDesktop &&
        !nextIsXl &&
        (isInitialSync ||
          previousDesktopMatches !== nextIsDesktop ||
          nextWidth < previousWidth);

      previousDesktopMatches = nextIsDesktop;
      previousWidth = nextWidth;

      if (!viewportModeChanged && !shouldCollapseDesktopSidebar) return;

      suppressSidebarAnimations();

      if (viewportModeChanged) {
        setIsDesktop(nextIsDesktop);
        isDesktopRef.current = nextIsDesktop;
        setMobileSidebarOpen(false);
      }

      if (shouldCollapseDesktopSidebar) {
        setDesktopSidebarOpen(false);
        desktopSidebarOpenRef.current = false;
      }
    };
    const handleViewportChange = () => {
      syncForViewport(false);
    };
    syncForViewport(true);
    // Resize reports every narrowing step, not only breakpoint crossings.
    window.addEventListener("resize", handleViewportChange);
    desktopMedia.addEventListener("change", handleViewportChange);
    xlMedia.addEventListener("change", handleViewportChange);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      desktopMedia.removeEventListener("change", handleViewportChange);
      xlMedia.removeEventListener("change", handleViewportChange);
      if (suppressTimerRef.current) {
        window.clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
      if (animationTimerRef.current) {
        window.clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
    };
  }, []);

  return (
    <AppShellContext.Provider value={value}>
      <div
        className={cn(
          "bg-background dark:bg-background relative mx-auto flex h-screen w-full flex-1 flex-col overflow-hidden",
          className,
        )}
      >
        {children}
      </div>
    </AppShellContext.Provider>
  );
}
