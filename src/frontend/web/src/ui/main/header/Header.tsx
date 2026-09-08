"use client";

import type { ReactNode } from "react";
import { Suspense, lazy, useState } from "react";
import { useLocation, useParams } from "@tanstack/react-router";
import { HeartPulse, Menu, Music2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { Button } from "@/ui/components/button";
import { EmotionalState } from "@/ui/components/emotional-state";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import { DEBUG_ENABLED } from "@/platform/env";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useAvatarRuntimeStore } from "@/stores/avatar-runtime-store";
import {
  AnimaInfoModal,
  type AnimaInfoSection,
} from "@/ui/main/header/AnimaInfoModal";
import { AudioVolumePanel, BgmTransportRow } from "@/ui/sound/SoundControls";
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

function SoundControlPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Open sound controls"
          className="text-muted-foreground hover:text-foreground"
        >
          <Music2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="border-border/70 bg-background/95 supports-[backdrop-filter]:bg-background/85 w-[22rem] rounded-2xl border p-4 shadow-lg backdrop-blur-md"
      >
        <div className="space-y-4">
          <AudioVolumePanel />
          <BgmTransportRow />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Header({
  actions,
  left,
  center,
  right,
  onMenuClick,
  className,
}: HeaderProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<AnimaInfoSection>("General");
  const [emotionPanelOpen, setEmotionPanelOpen] = useState(false);
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
  const useLiveEmotionState =
    isChatRoute && Boolean(currentAnimaId) && runtimeAnimaId === currentAnimaId;

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
  const openAnimaSection = (section: AnimaInfoSection) => {
    setEmotionPanelOpen(false);
    setActiveSection(section);
    setModalOpen(true);
  };
  const emotionalState = useLiveEmotionState
    ? runtimeEmotionalState
    : (activeAnima?.emotional_state ?? null);
  const emotionSourceLabel = useLiveEmotionState
    ? "Live runtime state"
    : "Persisted anima state";
  const defaultAnimaTrigger = animaLabel ? (
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        open={emotionPanelOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setEmotionPanelOpen(true);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={() => setEmotionPanelOpen((current) => !current)}
            className={cn(
              "text-muted-foreground hover:text-foreground/80 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-transparent transition-colors",
              emotionPanelOpen && "text-foreground/80",
            )}
            aria-label="Toggle emotional state panel"
            aria-pressed={emotionPanelOpen}
          >
            <HeartPulse className="h-6 w-6" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          sideOffset={10}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "border-border/70 bg-background/92 supports-[backdrop-filter]:bg-background/82 w-[17rem] max-w-[min(17rem,calc(100vw-2rem))] rounded-2xl border p-2 shadow-lg backdrop-blur-md",
          )}
        >
          <EmotionalState
            emotionalState={emotionalState}
            variant="compact"
            className="w-full"
            sourceLabel={emotionSourceLabel}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={() => openAnimaSection("General")}
        className={cn(
          "group hover:bg-muted/70 flex min-w-0 items-center gap-2 rounded-md bg-transparent px-2 py-1 transition",
        )}
        aria-label="Open anima details"
      >
        <div className="mx-4.5 min-w-0">
          <h1 className="text-foreground truncate text-lg font-semibold">
            {animaLabel}
          </h1>
        </div>
      </button>
    </div>
  ) : null;
  const leftContent = left ?? null;
  const centerContent = center ?? defaultAnimaTrigger ?? null;
  const rightContentBase =
    right ??
    (actions ? <div className="flex items-center gap-2">{actions}</div> : null);
  const soundButton = <SoundControlPopover />;
  const rightContent =
    rightContentBase || soundButton ? (
      <div className="flex items-center gap-2">
        {rightContentBase}
        {soundButton}
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
      <div className="pointer-events-auto grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
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
          <div className="min-w-0 justify-self-center">{centerContent}</div>
        ) : (
          <div />
        )}
        <div className="justify-self-end">{rightContent}</div>
      </div>
      <AnimaInfoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        animaLabel={animaLabel}
        anima={activeAnima}
        emotionState={emotionalState}
        emotionSourceLabel={emotionSourceLabel}
      />
    </header>
  );
}
