"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

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

export function AppShell({ children, className }: AppShellProps) {
  const [isDesktop, setIsDesktop] = useState(true);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
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

  useEffect(() => {
    isDesktopRef.current = isDesktop;
  }, [isDesktop]);

  useEffect(() => {
    desktopSidebarOpenRef.current = desktopSidebarOpen;
  }, [desktopSidebarOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const desktopMedia = window.matchMedia("(min-width: 768px)");
    const xlMedia = window.matchMedia("(min-width: 1280px)");
    let previousDesktopMatches = desktopMedia.matches;
    let previousXlMatches = xlMedia.matches;

    const syncForViewport = (isInitialSync = false) => {
      const nextIsDesktop = desktopMedia.matches;
      const nextIsXl = xlMedia.matches;
      const currentIsDesktop = isDesktopRef.current;
      const currentDesktopSidebarOpen = desktopSidebarOpenRef.current;
      const viewportModeChanged = currentIsDesktop !== nextIsDesktop;
      const shouldCollapseDesktopSidebar =
        currentDesktopSidebarOpen &&
        nextIsDesktop &&
        !nextIsXl &&
        (isInitialSync ||
          previousDesktopMatches !== nextIsDesktop ||
          previousXlMatches !== nextIsXl);

      previousDesktopMatches = nextIsDesktop;
      previousXlMatches = nextIsXl;

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
    desktopMedia.addEventListener("change", handleViewportChange);
    xlMedia.addEventListener("change", handleViewportChange);

    return () => {
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
