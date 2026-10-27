"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";

import type { PyAnimaListItem } from "@/lib/content/catalogTypes";
import { getAnimaDisplayName, getAnimaInitials } from "@/lib/anima-profile";
import { cn } from "@/lib/utils";
import { runtimeImageStyle } from "@/lib/runtime-content/imagePresentation";
import { useAnimaPresentationImage } from "@/query/hooks/useAnimaPresentationImage";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import { UnavailableAction } from "@/ui/components/unavailable-action";

export type AnimaCarouselProps = {
  animas: PyAnimaListItem[];
  selectedAnimaId: string | null;
  onSelect: (animaId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  /** Omit when the runtime does not offer Anima creation. */
  onCreate?: () => void;
  /** Without `onCreate`, keeps New Anima visible but disabled with this reason. */
  createUnavailableReason?: string;
  compact?: boolean;
  showNavigationButtons?: boolean;
  className?: string;
};

/** Translate a vertical wheel gesture into horizontal carousel movement. */
export function scrollAnimaCarouselWithWheel(
  element: Pick<HTMLElement, "clientWidth" | "scrollLeft" | "scrollWidth">,
  deltaX: number,
  deltaY: number,
  deltaMode = 0,
): boolean {
  if (Math.abs(deltaY) <= Math.abs(deltaX) || deltaY === 0) return false;
  const normalizedDeltaY =
    deltaMode === 1
      ? deltaY * 40
      : deltaMode === 2
        ? deltaY * element.clientWidth
        : deltaY;
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
  const next = Math.min(
    maximum,
    Math.max(0, element.scrollLeft + normalizedDeltaY),
  );
  if (next === element.scrollLeft) return false;
  element.scrollLeft = next;
  return true;
}

function AnimaCarouselItem({
  anima,
  selected,
  compact,
  registerNode,
  onSelect,
}: {
  anima: PyAnimaListItem;
  selected: boolean;
  compact: boolean;
  registerNode: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation("animas");
  const displayName = getAnimaDisplayName(anima);
  const presentationImage = useAnimaPresentationImage(
    anima.presentation.profile_thumbnail,
  );

  return (
    <button
      ref={registerNode}
      type="button"
      aria-current={selected ? "true" : undefined}
      aria-label={t("carousel.select", { name: displayName })}
      onClick={onSelect}
      className={cn(
        "group focus-visible:ring-ring/50 snap-center overflow-hidden rounded-2xl border text-left transition-[border-color,background-color,box-shadow,transform] outline-none focus-visible:ring-[3px] motion-reduce:transition-none",
        compact
          ? "w-[5.5rem] px-1.5 pt-1.5 pb-2"
          : "flex h-24 w-52 items-center pr-4 sm:w-56 xl:w-60 2xl:w-64",
        selected
          ? "border-lime-300 bg-lime-50/90 shadow-[0_0_0_2px_rgba(190,242,100,0.38)] dark:border-lime-400/70 dark:bg-lime-950/20"
          : "border-border/70 bg-background/72 hover:border-primary/45 hover:bg-background",
      )}
    >
      <Avatar
        className={cn(
          "bg-transparent transition-transform group-hover:scale-[1.02] motion-reduce:transition-none",
          compact
            ? "mx-auto size-14 rounded-xl"
            : "h-full w-24 self-end rounded-none",
        )}
      >
        {presentationImage.url ? (
          <AvatarImage
            alt=""
            src={presentationImage.url}
            className="object-cover"
            style={runtimeImageStyle(presentationImage.presentation)}
          />
        ) : null}
        <AvatarFallback
          className={cn(
            "font-semibold",
            compact ? "rounded-xl" : "rounded-none",
            selected
              ? "bg-primary/18 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {getAnimaInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className={cn("min-w-0", compact ? "" : "flex-1 pl-2.5 sm:pl-3")}>
        <span
          className={cn(
            "text-foreground block truncate font-medium",
            compact ? "mt-1.5 text-center text-[0.7rem]" : "text-base",
          )}
        >
          {displayName}
        </span>
        {presentationImage.isPending ? (
          <span
            className={cn(
              "text-muted-foreground mt-0.5 block text-[0.625rem]",
              compact ? "text-center" : "text-left",
            )}
          >
            {t("carousel.loading")}
          </span>
        ) : presentationImage.isError ? (
          <span
            className={cn(
              "text-destructive mt-0.5 block text-[0.625rem]",
              compact ? "text-center" : "text-left",
            )}
          >
            {t("carousel.initialsShown")}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/**
 * Renders lightweight presentation thumbnails only. Selection changes scroll
 * the active item into view without mounting neighboring runtime canvases.
 */
export function AnimaCarousel({
  animas,
  selectedAnimaId,
  onSelect,
  onPrevious,
  onNext,
  onCreate,
  createUnavailableReason,
  compact = false,
  showNavigationButtons = true,
  className,
}: AnimaCarouselProps) {
  const { t } = useTranslation("animas");
  const itemNodes = useRef(new Map<string, HTMLButtonElement>());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canMove = animas.length > 1;
  const newAnimaSize = compact
    ? "min-h-[5rem] w-[4.25rem]"
    : "h-24 w-[5.25rem]";
  const newAnimaContent = (
    <>
      <Plus className={compact ? "size-5" : "size-6"} />
      <span
        className={cn(
          "text-center font-medium whitespace-nowrap",
          compact ? "text-[0.65rem]" : "text-xs",
        )}
      >
        {t("carousel.newAnima")}
      </span>
    </>
  );
  const createAction = onCreate ? (
    <button
      type="button"
      onClick={onCreate}
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl transition-[background-color,color,box-shadow] outline-none hover:bg-lime-50/90 hover:shadow-[0_0_0_2px_rgba(190,242,100,0.38)] focus-visible:ring-[3px] motion-reduce:transition-none dark:hover:bg-lime-950/20",
        newAnimaSize,
      )}
      aria-label={t("carousel.create")}
    >
      {newAnimaContent}
    </button>
  ) : createUnavailableReason ? (
    <UnavailableAction reason={createUnavailableReason}>
      <button
        type="button"
        className={cn(
          "text-muted-foreground focus-visible:ring-ring/50 flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl outline-none focus-visible:ring-[3px]",
          newAnimaSize,
        )}
        aria-label={t("carousel.create")}
      >
        {newAnimaContent}
      </button>
    </UnavailableAction>
  ) : null;

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    if (
      scrollAnimaCarouselWithWheel(
        scrollContainer,
        event.deltaX,
        event.deltaY,
        event.deltaMode,
      )
    ) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    if (!selectedAnimaId) return;
    const selectedNode = itemNodes.current.get(selectedAnimaId);
    if (!selectedNode) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    selectedNode.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedAnimaId]);

  return (
    <div
      className={cn(
        "border-border/70 bg-card/88 flex min-w-0 items-stretch gap-2 rounded-[1.5rem] border shadow-2xl shadow-black/12 backdrop-blur-xl",
        compact ? "px-2 py-2" : "p-2",
        className,
      )}
      aria-label={t("carousel.label")}
      onWheel={handleWheel}
    >
      {createAction ? (
        <>
          {createAction}

          <div aria-hidden="true" className="bg-border/70 my-1 w-px shrink-0" />
        </>
      ) : null}

      <div className="relative min-w-0 flex-1 overflow-hidden">
        {showNavigationButtons ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canMove}
            aria-label={t("carousel.previous")}
            onClick={onPrevious}
            className="bg-background/92 absolute top-1/2 left-1 z-10 -translate-y-1/2 rounded-full shadow-sm"
          >
            <ChevronLeft className="size-5" />
          </Button>
        ) : null}

        <div
          ref={scrollContainerRef}
          className={cn(
            "flex h-full snap-x snap-mandatory [scrollbar-width:thin] gap-2 overflow-x-auto",
            showNavigationButtons ? "px-11" : "px-1",
            compact &&
              "min-h-[4.5rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          {animas.map((anima) => (
            <div key={anima.id} className="shrink-0 snap-center">
              <AnimaCarouselItem
                anima={anima}
                selected={anima.id === selectedAnimaId}
                compact={compact}
                registerNode={(node) => {
                  if (node) {
                    itemNodes.current.set(anima.id, node);
                  } else {
                    itemNodes.current.delete(anima.id);
                  }
                }}
                onSelect={() => onSelect(anima.id)}
              />
            </div>
          ))}
        </div>

        {showNavigationButtons ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canMove}
            aria-label={t("carousel.next")}
            onClick={onNext}
            className={cn(
              "bg-background/92 absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-full shadow-sm",
            )}
          >
            <ChevronRight className="size-5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
