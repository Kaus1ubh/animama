"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ExternalLink,
  Settings,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";

import type { PyAnimaResponse } from "@/lib/content/catalogTypes";
import { getAnimaDisplayName } from "@/lib/anima-profile";
import { runtimeImagePresentation } from "@/lib/runtime-content/animaRuntimeSnapshot";
import { useRuntimeContentMediaUrl } from "@/query/hooks/useRuntimeContentMediaUrl";
import { adaptRuntimeSnapshot } from "@/lib/runtime-content/runtimeSnapshotAdapter";
import { useAnimas } from "@/query/hooks/useAnimas";
import { useAnimaRuntimeCatalog } from "@/query/hooks/useAnimaRuntimeCatalog";
import { useAnimaPresentationImage } from "@/query/hooks/useAnimaPresentationImage";
import {
  AnimaAppearanceDialog,
  type AnimaAppearanceSection,
} from "@/ui/animas/AnimaAppearanceDialog";
import { MemoryEntryEditorModal } from "@/ui/memory/MemoryEntryEditorModal";
import { AnimaIdentitySection } from "@/ui/animas/AnimaIdentitySection";
import { useMemoryEntryByPath } from "@/query/hooks/useMemoryEntries";
import { resolveAnimaIdentityContent } from "@/lib/animas/anima-management-presentation";
import { DialogOverlay } from "@/ui/components/dialog";
import { Button } from "@/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";
import {
  EmotionSummary,
  EmotionDetails,
} from "@/ui/components/emotional-state";
import { cn } from "@/lib/utils";
import { buildEmotionPresentation } from "@/lib/emotion/presentation";
import { canShowEmotionPopout } from "./animaModalPresentation";
import { RuntimeImageFrame } from "@/ui/components/runtime-image-frame";
import { AnimaSettingsModal } from "@/ui/main/header/AnimaSettingsModal";

type AnimaInfoModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  animaLabel?: string;
  anima?: PyAnimaResponse | null;
  emotionState?: unknown;
  emotionSourceLabel?: string | null;
};

/** Each opening gets a fresh profile session; Anima changes also reset transient UI. */
export function AnimaInfoModal(props: AnimaInfoModalProps) {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <AnimaProfile key={props.anima?.id ?? "empty"} {...props} />
      ) : null}
    </Dialog.Root>
  );
}

function AnimaProfile({
  open,
  onOpenChange,
  animaLabel,
  anima,
  emotionState,
  emotionSourceLabel = null,
}: AnimaInfoModalProps) {
  const navigate = useNavigate();
  const emotionalState =
    emotionState === undefined
      ? (anima?.emotional_state ?? null)
      : emotionState;
  const hasActiveEmotions =
    buildEmotionPresentation(emotionalState).topGroups.length > 0;
  const [view, setView] = useState<"profile" | "settings">("profile");
  const [emotionsOpen, setEmotionsOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const hoverMode = sidePanel && canHover && hasActiveEmotions;
  useEffect(() => {
    if (!hasActiveEmotions) setEmotionsOpen(false);
  }, [hasActiveEmotions]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const detailPanelRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHoverClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const openOnHover = () => {
    cancelHoverClose();
    if (hoverMode) setEmotionsOpen(true);
  };
  const scheduleHoverClose = () => {
    if (!hoverMode) return;
    cancelHoverClose();
    // Give the pointer time to cross the 16px gap into the detail surface.
    closeTimer.current = setTimeout(() => {
      if (
        summaryRef.current?.matches(":hover") ||
        detailPanelRef.current?.matches(":hover")
      )
        return;
      const focused = document.activeElement;
      if (
        focused?.matches(":focus-visible") &&
        (summaryRef.current?.contains(focused) ||
          detailPanelRef.current?.contains(focused))
      )
        return;
      setEmotionsOpen(false);
    }, 180);
  };
  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [hoverMode],
  );
  const [profileElement, setProfileElement] = useState<HTMLDivElement | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const profileScroll = useRef(0);
  const emotionTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emotionPanelId = useId();
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const profile = profileElement;
    if (!profile) return;
    const measure = () =>
      setSidePanel(
        canShowEmotionPopout(
          profile.getBoundingClientRect().right,
          window.innerWidth,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(profile);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [profileElement]);

  const returnToProfile = () => {
    setView("profile");
    requestAnimationFrame(() => {
      if (scrollRef.current)
        scrollRef.current.scrollTop = profileScroll.current;
      settingsTriggerRef.current?.focus({ preventScroll: true });
    });
  };
  const collapseEmotions = () => {
    cancelHoverClose();
    // Focus can reveal the panel; apply the explicit dismissal after restoring it.
    (hoverMode ? summaryRef.current : emotionTriggerRef.current)?.focus({
      preventScroll: true,
    });
    setEmotionsOpen(false);
  };
  const [identityEditorOpen, setIdentityEditorOpen] = useState(false);
  const identityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const appearanceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [appearanceSection, setAppearanceSection] =
    useState<AnimaAppearanceSection | null>(null);
  const animasQuery = useAnimas({ enabled: open });
  // Editable appearance follows live queries; chat retains its mounted runtime.
  const runtimeQuery = useAnimaRuntimeCatalog(open ? anima?.id : null);
  const backgroundEntry = useMemo(
    () =>
      runtimeQuery.data
        ? adaptRuntimeSnapshot(runtimeQuery.data).background_image
        : null,
    [runtimeQuery.data],
  );
  const identityQuery = useMemoryEntryByPath({
    animaId: anima?.id,
    path: "IDENTITY.md",
    type: "file",
    enabled: open && Boolean(anima?.id),
  });
  const openAnimaDetailsPage = (animaId: string) => {
    onOpenChange(false);
    void navigate({
      to: "/a/animas/$animaId",
      params: { animaId },
    });
  };

  const displayName = anima
    ? getAnimaDisplayName(anima)
    : (animaLabel ?? "Anima");
  const fallbackIdentity = anima?.avatar?.identity?.trim() ?? "";
  const identity = resolveAnimaIdentityContent(
    identityQuery.data?.content,
    fallbackIdentity,
  );
  const profileThumbnail =
    animasQuery.data?.find((candidate) => candidate.id === anima?.id)
      ?.presentation.profile_thumbnail ?? null;
  const profileImage = useAnimaPresentationImage(profileThumbnail);
  const backgroundImage = useRuntimeContentMediaUrl(backgroundEntry);

  const details = (
    <EmotionDetails
      showSummary={false}
      emotionalState={emotionalState}
      sourceLabel={emotionSourceLabel}
    />
  );
  const duration = reducedMotion ? 0 : 0.18;
  const iconButtonClass =
    "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none";
  const appearanceButtonClass =
    "focus-visible:ring-ring flex size-10 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

  return (
    <Dialog.Portal>
      <DialogOverlay className="z-40" />
      <Dialog.Content
        ref={dialogRef}
        tabIndex={-1}
        className="fixed top-1/2 left-1/2 z-50 h-[min(820px,calc(100dvh-32px))] w-[640px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 outline-none"
        onOpenAutoFocus={(event) => {
          openerRef.current = document.activeElement as HTMLElement | null;
          // Start at the profile itself so opening it does not focus a tooltip trigger.
          event.preventDefault();
          dialogRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openerRef.current?.isConnected) openerRef.current.focus();
        }}
        onEscapeKeyDown={(event) => {
          // Radix gives nested editors first refusal on Escape.
          if (appearanceSection || identityEditorOpen) return;
          if (emotionsOpen && view === "profile") {
            event.preventDefault();
            collapseEmotions();
          }
        }}
      >
        <Dialog.Description className="sr-only">
          Appearance, emotions, identity and settings.
        </Dialog.Description>
        <div
          ref={setProfileElement}
          className="border-border bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-end gap-1 px-4 py-3 sm:px-5">
            {view === "settings" ? (
              <Button
                ref={backRef}
                variant="ghost"
                size="sm"
                className="mr-auto shrink-0"
                onClick={returnToProfile}
              >
                <ArrowLeft aria-hidden="true" className="size-4" /> Back
              </Button>
            ) : null}
            <Dialog.Title className="sr-only">{displayName}</Dialog.Title>
            {anima?.id ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={iconButtonClass}
                    aria-label="See full details"
                    onClick={() => openAnimaDetailsPage(anima.id)}
                  >
                    <ExternalLink className="size-5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>See full details</TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={settingsTriggerRef}
                  type="button"
                  className={iconButtonClass}
                  aria-label="Anima Settings"
                  aria-pressed={view === "settings"}
                  onClick={() => {
                    if (view === "settings") {
                      returnToProfile();
                      return;
                    }
                    profileScroll.current = scrollRef.current?.scrollTop ?? 0;
                    setView("settings");
                    requestAnimationFrame(() => backRef.current?.focus());
                  }}
                >
                  <Settings className="size-5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Anima Settings</TooltipContent>
            </Tooltip>
            <Dialog.Close asChild>
              <button
                type="button"
                className={iconButtonClass}
                aria-label="Close anima profile"
                title="Close"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div
            ref={scrollRef}
            hidden={view !== "profile"}
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-7 sm:px-5"
          >
            <div className="bg-muted relative h-36 overflow-hidden rounded-t-xl sm:h-44">
              {backgroundImage.url ? (
                <RuntimeImageFrame
                  src={backgroundImage.url}
                  alt={`${displayName} background`}
                  presentation={runtimeImagePresentation(backgroundEntry)}
                  className="size-full"
                />
              ) : null}
              {anima?.id ? (
                <button
                  type="button"
                  onClick={(event) => {
                    appearanceTriggerRef.current = event.currentTarget;
                    setAppearanceSection("background_image");
                  }}
                  aria-label="Edit background image"
                  className={cn(
                    appearanceButtonClass,
                    "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                  )}
                >
                  <Camera className="size-5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="px-1 sm:px-2">
              <div className="grid grid-cols-1 gap-x-5 min-[560px]:grid-cols-[160px_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="border-background bg-muted relative -mt-16 flex size-32 items-center justify-center rounded-full border-[5px] sm:-mt-[72px] sm:size-36">
                    {profileImage.url ? (
                      <RuntimeImageFrame
                        src={profileImage.url}
                        alt={`${displayName} profile`}
                        presentation={profileImage.presentation}
                        className="size-full rounded-full"
                      />
                    ) : (
                      <span className="text-muted-foreground text-2xl font-semibold">
                        {displayName.slice(0, 2).toLocaleUpperCase()}
                      </span>
                    )}
                    {anima?.id ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          appearanceTriggerRef.current = event.currentTarget;
                          setAppearanceSection("profile_image");
                        }}
                        aria-label="Edit profile image"
                        className={cn(
                          appearanceButtonClass,
                          "border-background absolute right-0 bottom-0 border-[3px]",
                        )}
                      >
                        <Camera className="size-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div
                  ref={summaryRef}
                  className={cn(
                    "rounded-lg outline-none",
                    hoverMode &&
                      "focus-visible:ring-ring cursor-default focus-visible:ring-2",
                  )}
                  tabIndex={hoverMode ? 0 : undefined}
                  role={hoverMode ? "button" : undefined}
                  aria-label={hoverMode ? "Explore emotions" : undefined}
                  aria-expanded={hoverMode ? emotionsOpen : undefined}
                  aria-controls={hoverMode ? emotionPanelId : undefined}
                  onPointerEnter={openOnHover}
                  onPointerLeave={scheduleHoverClose}
                  onFocus={() => {
                    if (hoverMode) {
                      cancelHoverClose();
                      setEmotionsOpen(true);
                    }
                  }}
                  onBlur={scheduleHoverClose}
                  onKeyDown={(event) => {
                    if (
                      hoverMode &&
                      emotionsOpen &&
                      event.key === "Tab" &&
                      !event.shiftKey
                    ) {
                      const firstAxis =
                        detailPanelRef.current?.querySelector<SVGGElement>(
                          "[data-emotion-axis-label]",
                        );
                      if (firstAxis) {
                        event.preventDefault();
                        firstAxis.focus();
                        return;
                      }
                    }
                    if (
                      hoverMode &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      setEmotionsOpen((previous) => !previous);
                    }
                  }}
                >
                  <EmotionSummary
                    emotionalState={emotionalState}
                    className="pt-4"
                    headerAction={
                      hoverMode || !hasActiveEmotions ? undefined : (
                        <button
                          ref={emotionTriggerRef}
                          type="button"
                          aria-expanded={emotionsOpen}
                          aria-controls={emotionPanelId}
                          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-0.5 rounded-md py-1 pl-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
                          onClick={() =>
                            setEmotionsOpen((previous) => !previous)
                          }
                        >
                          Emotions
                          <ChevronDown
                            aria-hidden="true"
                            className={cn(
                              "size-4",
                              emotionsOpen && "rotate-180",
                            )}
                          />
                        </button>
                      )
                    }
                  />
                </div>
              </div>
              <AnimatePresence initial={false}>
                {hasActiveEmotions && emotionsOpen && !sidePanel ? (
                  <motion.section
                    key="inline-emotions"
                    id={emotionPanelId}
                    aria-label="Emotions"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration }}
                    className="overflow-hidden"
                  >
                    <div className="border-border/70 mt-5 border-t pt-5">
                      {details}
                    </div>
                  </motion.section>
                ) : null}
              </AnimatePresence>
              <section
                className="border-border/70 mt-6 border-t pt-5"
                aria-label="Identity"
              >
                {anima?.id ? (
                  <AnimaIdentitySection
                    animaId={anima.id}
                    identity={identity}
                    identityLoading={identityQuery.isLoading}
                    identityError={identityQuery.isError}
                    fallbackIdentity={fallbackIdentity}
                    onEdit={(event) => {
                      identityTriggerRef.current = event.currentTarget;
                      setIdentityEditorOpen(true);
                    }}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No identity content provided yet.
                  </p>
                )}
              </section>
            </div>
          </div>
          {view === "settings" ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
              <h2 className="mb-4 text-xl font-semibold">
                {displayName} settings
              </h2>
              <AnimaSettingsModal />
            </div>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {hasActiveEmotions &&
          emotionsOpen &&
          sidePanel &&
          view === "profile" ? (
            <motion.section
              key="side-emotions"
              ref={detailPanelRef}
              onPointerEnter={cancelHoverClose}
              onPointerLeave={scheduleHoverClose}
              onFocusCapture={cancelHoverClose}
              onBlurCapture={scheduleHoverClose}
              id={emotionPanelId}
              aria-label="Emotions"
              initial={{ x: reducedMotion ? 0 : -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: reducedMotion ? 0 : -12, opacity: 0 }}
              transition={{ duration }}
              className="border-border bg-background absolute top-0 left-[calc(100%+16px)] max-h-full w-[360px] overflow-y-auto overscroll-contain rounded-2xl border px-3 py-1 shadow-xl"
            >
              <h2 className="pointer-events-none absolute top-3 left-4 text-sm font-semibold">
                Emotions
              </h2>
              {details}
            </motion.section>
          ) : null}
        </AnimatePresence>
        {anima?.id && identityEditorOpen ? (
          <MemoryEntryEditorModal
            animaId={anima.id}
            path="IDENTITY.md"
            allowedScope="anima"
            onClose={() => setIdentityEditorOpen(false)}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              identityTriggerRef.current?.focus({ preventScroll: true });
            }}
          />
        ) : null}
        {anima?.id && appearanceSection ? (
          <AnimaAppearanceDialog
            animaId={anima.id}
            animaName={displayName}
            profileThumbnail={profileThumbnail}
            section={appearanceSection}
            onSectionChange={setAppearanceSection}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              appearanceTriggerRef.current?.focus();
            }}
            onOpenChange={(next) => !next && setAppearanceSection(null)}
          />
        ) : null}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
