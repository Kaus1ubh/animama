"use client";

import type { ReactNode } from "react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useParams } from "@tanstack/react-router";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { motion, useReducedMotion } from "motion/react";
import { DEBUG_ENABLED } from "@/platform/env";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import { AnimaInfoModal } from "@/ui/main/header/AnimaInfoModal";
import { selectHeaderEmotionState } from "./animaModalPresentation";
import { getAnimaDisplayName } from "@/lib/anima-profile";

type HeaderProps = {
  actions?: ReactNode;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  onMenuClick?: () => void;
  className?: string;
};

const LazyHeaderDebugControls =
  __ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED
    ? lazy(() => import("@/ui/debug/HeaderDebugControls"))
    : null;

export function Header({
  actions,
  left,
  center,
  right,
  onMenuClick,
  className,
}: HeaderProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [nameHovered, setNameHovered] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const nameHighlighted = nameHovered || nameFocused;
  const {
    data: animas = [],
    isLoading,
    isError,
  } = useAnimas({
    enabled: left === undefined && center === undefined,
  });

  const params = useParams({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const currentAnimaId =
    typeof params?.animaId === "string" ? params.animaId : null;
  const activeAnima = currentAnimaId
    ? animas.find((p) => p.id === currentAnimaId)
    : animas[0];
  const runtimeAnimaId = useAvatarRuntimeStore((state) => state.animaId);
  const runtimeEmotionalState = useAvatarRuntimeStore(
    (state) => state.emotionalState,
  );
  const isChatRoute =
    typeof pathname === "string" &&
    pathname.startsWith("/a/") &&
    !pathname.startsWith("/a/animas/") &&
    !pathname.startsWith("/a/create");
  useEffect(() => {
    setModalOpen(false);
  }, [currentAnimaId]);

  const appShell = useOptionalAppShell();
  const handleMenuClick =
    onMenuClick ?? appShell?.toggleSidebar ?? appShell?.openSidebar;
  const showMenuButton = Boolean(handleMenuClick);
  // const desktopSidebarInset = appShell?.isDesktop === true ? 88 : 0;
  // Ignore sidebar when it comes to centered title, may impact left header content...
  const desktopSidebarInset = 0;
  const headerStyle =
    desktopSidebarInset > 0
      ? {
          marginLeft: `${desktopSidebarInset}px`,
          width: `calc(100% - ${desktopSidebarInset}px)`,
        }
      : undefined;
  const animaName = activeAnima ? getAnimaDisplayName(activeAnima) : null;
  const animaLabel = isLoading
    ? "Loading anima..."
    : isError
      ? "Anima"
      : animaName || "No anima";
  const openAnimaProfile = () => {
    setModalOpen(true);
  };
  const { state: emotionalState, sourceLabel: emotionSourceLabel } =
    selectHeaderEmotionState({
      isChatRoute,
      currentAnimaId,
      runtimeAnimaId,
      runtimeState: runtimeEmotionalState,
      persistedState: activeAnima?.emotional_state,
    });
  const defaultAnimaTrigger = animaLabel ? (
    <button
      type="button"
      onClick={openAnimaProfile}
      onMouseEnter={() => setNameHovered(true)}
      onMouseLeave={() => setNameHovered(false)}
      onFocus={() => setNameFocused(true)}
      onBlur={() => setNameFocused(false)}
      className="focus-visible:ring-ring relative isolate max-w-full min-w-0 rounded-xl p-[2px] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      aria-label="Open anima details"
      aria-haspopup="dialog"
      aria-expanded={modalOpen}
    >
      {/* Decorative layers are invisible and stationary until hover or focus. */}
      {[true, false].map((glow) => (
        <motion.span
          key={String(glow)}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 rounded-xl",
            glow && "blur-md",
          )}
          initial={false}
          animate={{
            opacity: nameHighlighted ? (glow ? 0.4 : 0.8) : 0,
            backgroundPosition:
              nameHighlighted && !reducedMotion
                ? ["0% 50%", "100% 50%", "0% 50%"]
                : "0% 50%",
          }}
          transition={{
            opacity: { duration: reducedMotion ? 0 : 0.2 },
            backgroundPosition: {
              duration: nameHighlighted && !reducedMotion ? 5 : 0,
              repeat: nameHighlighted && !reducedMotion ? Infinity : 0,
              ease: "linear",
            },
          }}
          style={{
            backgroundSize: "400% 400%",
            backgroundImage:
              "radial-gradient(circle farthest-side at 0 100%, #00ccb1, transparent), radial-gradient(circle farthest-side at 100% 0, #7b61ff, transparent), radial-gradient(circle farthest-side at 100% 100%, #ffc414, transparent), radial-gradient(circle farthest-side at 0 0, #1ca0fb, #141316)",
          }}
        />
      ))}
      <div
        className={cn(
          "relative flex min-w-0 items-center rounded-[10px] px-4 py-1.5 sm:px-6",
          nameHighlighted && "bg-background",
        )}
      >
        <h1 className="text-foreground truncate text-lg font-semibold">
          {animaLabel}
        </h1>
      </div>
    </button>
  ) : null;
  const leftContent = left ?? null;
  const centerContent = center ?? defaultAnimaTrigger ?? null;
  const rightContentBase =
    right ??
    (actions ? <div className="flex items-center gap-2">{actions}</div> : null);
  const rightContent =
    rightContentBase || LazyHeaderDebugControls ? (
      <div className="flex items-center gap-2">
        {rightContentBase}
        {LazyHeaderDebugControls ? (
          <Suspense fallback={null}>
            <LazyHeaderDebugControls animaLabel={animaLabel} />
          </Suspense>
        ) : null}
      </div>
    ) : null;

  return (
    <header
      className={cn(
        "group flex items-center justify-between bg-transparent px-4 py-3 transition-[margin-left,width] duration-150 ease-in-out",
        className,
      )}
      style={headerStyle}
    >
      <div className="pointer-events-auto grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {showMenuButton ? (
            <button
              type="button"
              aria-label="Open sidebar"
              onClick={handleMenuClick}
              className={cn(
                "text-foreground hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                "md:hidden",
              )}
            >
              <Menu className="h-4 w-4" />
            </button>
          ) : null}
          {leftContent ? <div className="min-w-0">{leftContent}</div> : null}
        </div>
        {centerContent ? (
          <div className="max-w-full min-w-0 justify-self-center [&>div]:max-w-full">
            {centerContent}
          </div>
        ) : (
          <div />
        )}
        <div className="justify-self-end">{rightContent}</div>
      </div>
      <AnimaInfoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        animaLabel={animaLabel}
        anima={activeAnima}
        emotionState={emotionalState}
        emotionSourceLabel={emotionSourceLabel}
      />
    </header>
  );
}
