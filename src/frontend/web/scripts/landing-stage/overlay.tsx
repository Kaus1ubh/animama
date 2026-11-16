import {
  Fragment,
  createElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { i18n as I18nInstance } from "i18next";
import { MotionConfig, motion, type Variants } from "motion/react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Brain,
} from "lucide-react";

import { Message, MessageContent } from "@animama/product-ui/components";
import { AnimamaI18nProvider } from "@animama/product-ui/i18n";

import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import MessageLoaderV2 from "@/ui/components/message-loader-v2";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/ui/components/dropdown-menu";
import { TextEffect, type TextEffectProps } from "@/ui/components/text-effect";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ui/components/tooltip";

import type { StageController, StageState } from "./controller";
import { useLanding, type LandingKey, type LandingT } from "./i18n";
import { MoodBloom } from "./mood-bloom";
import { PROGRAM } from "./program";
import { TextShimmer } from "./text-shimmer";
import { SocialIcon } from "./social-icons";
import { SiteHeader, focusRing } from "./site-header";
import {
  BETA_ACCESS_URL,
  CLOSED_BETA,
  FOOTER_LINKS,
  SITE,
  STAGE_AVATARS,
  STAGE_STOPS,
  voice,
  type StageAvatar,
  type StageClip,
  type StageStop,
  stopClips,
  stopCopy,
  type MemoryNote,
} from "./stops";
import { captionWords, continuesWord, unspaced } from "./words";

/*
 * The landing page's DOM layer over the 3D stage: header, progress, one
 * scroll section per stop with its caption, and each stop's demo (emotion
 * mascots, gesture chips and the memory story). Built
 * from the app's own components and theme tokens.
 */

const DOCS_URL = SITE.docsUrl;

type StopProps = {
  stop: StageStop;
  index: number;
  active: boolean;
  /** The Avatar on stage, for names and pronouns. */
  avatar: StageAvatar;
  state: StageState;
  controller: StageController;
};

/** Render the overlay now, so its scroll sections exist when this returns. */
export function mountOverlay(
  root: HTMLElement,
  controller: StageController,
  i18n: I18nInstance,
) {
  const reactRoot = createRoot(root);
  flushSync(() =>
    reactRoot.render(
      <AnimamaI18nProvider i18n={i18n}>
        {/* Motion entrances keep their fades but drop movement when the
            visitor asks for reduced motion. */}
        <MotionConfig reducedMotion="user">
          <Overlay controller={controller} />
        </MotionConfig>
      </AnimamaI18nProvider>,
    ),
  );
}

function Overlay({ controller }: { controller: StageController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { t, locale } = useLanding();
  const active = Math.max(0, state.active);
  const light = STAGE_STOPS[active].ink === "light";
  const avatar =
    STAGE_AVATARS.find(({ id }) => id === state.avatar) ?? STAGE_AVATARS[0];
  // The tab's title follows the language; `index.html` keeps the English one.
  useEffect(() => {
    document.title = t("site.title");
  }, [t, locale]);
  return (
    <>
      <a
        href="#content"
        className="bg-card text-foreground focus-visible:ring-ring sr-only z-50 rounded-full px-4 py-2 text-sm font-medium shadow-md outline-none focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus-visible:ring-2"
      >
        {t("page.skipToContent")}
      </a>
      <SiteHeader
        light={light}
        tour={{
          scrollToStop: (index) => controller.scrollToStop(index),
          avatarSwitcher: (
            <AvatarSwitcher
              state={state}
              light={light}
              controller={controller}
            />
          ),
          // The stills show her only.
          avatarOptions: state.fallback ? null : (
            <AvatarOptions state={state} controller={controller} />
          ),
        }}
      />
      <ProgressThread
        active={active}
        light={light}
        revealed={state.revealed}
        avatar={avatar}
        controller={controller}
      />
      <Trailer active={active === 0} revealed={state.revealed} />
      <main id="content" tabIndex={-1} className="outline-none">
        {/* The 3D stage itself is hidden from screen readers. */}
        <p className="sr-only">
          {voice(t("site.sceneDescription"), avatar, t)}
        </p>
        {STAGE_STOPS.map((stop, index) => (
          <section
            key={stop.id}
            id={`stop-${stop.id}`}
            className="h-svh snap-start"
          >
            <Stop
              stop={stop}
              index={index}
              active={index === active}
              avatar={avatar}
              state={state}
              controller={controller}
            />
          </section>
        ))}
      </main>
    </>
  );
}

/** Page scroll as a share (0–1) of the way from the first stop to the last. */
function useScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const span = window.innerHeight * (STAGE_STOPS.length - 1);
      setProgress(Math.min(1, Math.max(0, window.scrollY / Math.max(1, span))));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return progress;
}

/**
 * The Avatars the page can show, as round portraits in a glass pill beside
 * the header's links: the one on stage ringed and the others in greyscale.
 * Choosing one loads it in place; it pulses while it loads. Shown once the
 * hero entrance reaches her wave. Phones choose from the menu instead
 * (`AvatarOptions`), as the header has no room for it there.
 */
function AvatarSwitcher({
  state,
  light,
  controller,
}: {
  state: StageState;
  light: boolean;
  controller: StageController;
}) {
  const { t } = useLanding();
  // The stills show her only.
  if (state.fallback) return null;
  return (
    <nav
      aria-label={t("page.avatars")}
      className={cn(
        // The reveal fades this wrapper: `.liquid-glass` sets its own transition.
        "transition-opacity duration-700 max-sm:hidden",
        state.revealed
          ? "opacity-100 delay-700"
          : "pointer-events-none opacity-0",
      )}
    >
      <div
        data-ink={light ? "light" : "dark"}
        className="liquid-glass flex items-center gap-1 rounded-full p-1"
      >
        {STAGE_AVATARS.map((avatar) => {
          const isActive = avatar.id === state.avatar;
          const loading = avatar.id === state.avatarLoading;
          return (
            <Tooltip key={avatar.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={avatar.name}
                  aria-pressed={isActive}
                  aria-busy={loading}
                  disabled={
                    !state.ready || (state.avatarLoading !== null && !loading)
                  }
                  onClick={() => controller.selectAvatar(avatar.id)}
                  className={cn(
                    "focus-visible:ring-ring focus-visible:ring-offset-background flex size-9 cursor-pointer items-center justify-center rounded-full p-0 transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    isActive && "ring-primary ring-2",
                    loading && "motion-safe:animate-pulse",
                  )}
                >
                  <Avatar className="size-9">
                    <AvatarImage
                      alt=""
                      src={PROGRAM.portraits[avatar.id]}
                      className={cn(
                        "transition-[filter,opacity] duration-200",
                        !isActive && !loading && "opacity-70 grayscale",
                      )}
                    />
                    <AvatarFallback className="text-xs font-medium">
                      {avatar.name.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {loading
                  ? t("page.loadingAvatar", { name: avatar.name })
                  : avatar.name}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}

/** The Avatar choice as menu items, for phones (see `AvatarSwitcher`). */
function AvatarOptions({
  state,
  controller,
}: {
  state: StageState;
  controller: StageController;
}) {
  const { t } = useLanding();
  return (
    <DropdownMenuRadioGroup
      value={state.avatar}
      onValueChange={(id) => controller.selectAvatar(id)}
    >
      {STAGE_AVATARS.map((avatar) => (
        <DropdownMenuRadioItem
          key={avatar.id}
          value={avatar.id}
          disabled={!state.ready || state.avatarLoading !== null}
          className="gap-2.5"
        >
          <Avatar className="size-5">
            <AvatarImage alt="" src={PROGRAM.portraits[avatar.id]} />
            <AvatarFallback className="text-[0.5rem]">
              {avatar.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          {avatar.id === state.avatarLoading
            ? t("page.loadingAvatar", { name: avatar.name })
            : avatar.name}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/**
 * Where the visitor is: a thin vertical thread that fills as the page
 * scrolls, the caring mascot riding its tip, and the stop counter and name
 * beside it. Each stop is a dot on the thread that scrolls to it; a ring
 * ripples out from a stop's dot as the visitor arrives.
 */
function ProgressThread({
  active,
  light,
  revealed,
  avatar,
  controller,
}: {
  active: number;
  light: boolean;
  /** Hidden until the hero entrance reaches her wave. */
  revealed: boolean;
  avatar: StageAvatar;
  controller: StageController;
}) {
  const progress = useScrollProgress();
  const { t } = useLanding();
  const copies = STAGE_STOPS.map((stop) => stopCopy(stop, avatar, t));
  const last = STAGE_STOPS.length - 1;
  const at = (share: number) => `${share * 100}%`;
  const count = (value: number) => String(value).padStart(2, "0");
  return (
    <nav
      aria-label={t("page.features")}
      className={cn(
        "fixed top-1/2 left-10 z-40 hidden h-[min(26rem,54vh)] -translate-y-1/2 transition-opacity duration-700 md:block",
        revealed ? "opacity-100 delay-700" : "pointer-events-none opacity-0",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1 -translate-x-1/2 rounded-full transition-colors duration-500",
          light ? "bg-white/30" : "bg-foreground/10",
        )}
      />
      <div
        className="bg-primary absolute top-0 left-0 w-1 -translate-x-1/2 rounded-full"
        style={{ height: at(progress) }}
      />
      {STAGE_STOPS.map((stop, index) => (
        // Each stop's target covers its whole stretch of the thread, so a
        // click anywhere on the thread lands on the nearest stop.
        <button
          key={stop.id}
          type="button"
          aria-label={copies[index].title}
          aria-current={index === active ? "step" : undefined}
          onClick={() => controller.scrollToStop(index)}
          className="group focus-visible:ring-ring absolute left-0 flex w-12 -translate-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2"
          style={{ top: at(index / last), height: `${100 / last}%` }}
        >
          <span
            className={cn(
              "size-3 rounded-full ring-4 ring-transparent transition-[background-color,scale,box-shadow] duration-300 group-hover:scale-125",
              index / last <= progress + 0.001
                ? "bg-primary group-hover:ring-primary/25"
                : light
                  ? "bg-white/50 group-hover:ring-white/20"
                  : "bg-foreground/20 group-hover:ring-foreground/10",
            )}
          />
          {index === active ? (
            <span
              key={active}
              aria-hidden="true"
              className="thread-arrive border-primary absolute top-1/2 left-1/2 size-6 -translate-1/2 rounded-full border-2"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute left-full -ml-1 rounded-full px-2.5 py-1 text-sm font-medium whitespace-nowrap opacity-0 shadow-sm transition-[opacity,translate] duration-200 group-hover:translate-x-1 group-hover:opacity-100 group-focus-visible:opacity-100",
                light
                  ? "bg-white/20 text-white backdrop-blur"
                  : "bg-card text-foreground border",
              )}
            >
              {copies[index].label}
            </span>
          )}
        </button>
      ))}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 flex -translate-y-1/2 items-center"
        style={{ top: at(progress) }}
      >
        <img
          src="/emotions/caring-very.webp"
          alt=""
          className="thread-knob size-9 max-w-none -translate-x-1/2 object-contain"
        />
        <span
          className={cn(
            "ml-1 flex flex-col leading-tight whitespace-nowrap transition-colors duration-500",
            light ? "text-white" : "text-foreground",
          )}
        >
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              light ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {count(active + 1)} / {count(last + 1)}
          </span>
          <span key={active} className="thread-label text-base font-semibold">
            {copies[active].label}
          </span>
        </span>
      </div>
    </nav>
  );
}

/**
 * The launch trailer, bottom right over the hero once her wave has revealed
 * its text: a poster that, played, becomes YouTube's privacy-enhanced player
 * in place, so nothing reaches YouTube until then. Without JavaScript the
 * poster opens the video on YouTube. Leaving the hero unloads the player,
 * which stops it.
 */
function Trailer({ active, revealed }: { active: boolean; revealed: boolean }) {
  const { t } = useLanding();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  const shown = active && revealed;
  return (
    <div
      className={cn(
        "fixed right-(--gutter) bottom-6 z-30 w-[min(20rem,42vw)] transition-[opacity,translate,visibility] duration-500 max-md:w-44 md:bottom-8",
        shown
          ? "visible translate-y-0 opacity-100"
          : "pointer-events-none invisible translate-y-3 opacity-0 motion-reduce:translate-y-0",
      )}
      aria-hidden={!shown}
    >
      {playing ? (
        <iframe
          src={`${SITE.trailer.embed}?autoplay=1&rel=0`}
          title={t("page.trailerTitle")}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video w-full rounded-xl border-0 shadow-lg"
        />
      ) : (
        <a
          href={SITE.trailer.url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            setPlaying(true);
          }}
          aria-label={t("page.watchTrailer")}
          className="group focus-visible:ring-ring block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <span className="relative block overflow-hidden rounded-xl shadow-lg ring-1 ring-black/5">
            <img
              src={SITE.trailer.poster}
              alt=""
              width={768}
              height={432}
              className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <YouTubePlayButton className="h-12 w-[68px] opacity-90 drop-shadow-md transition-opacity group-hover:opacity-100 max-md:h-9 max-md:w-[51px]" />
            </span>
          </span>
        </a>
      )}
    </div>
  );
}

/**
 * YouTube's familiar play button (its embed player's red rounded rectangle
 * with a white triangle), so the poster reads as a video at a glance.
 */
function YouTubePlayButton({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 68 48" aria-hidden="true" className={className}>
      <path
        d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z"
        fill="#f00"
      />
      <path d="M45 24 27 14v20z" fill="#fff" />
    </svg>
  );
}

/** The stage layer between the backdrop and the Avatar canvas. */
const heroLayer = document.getElementById("hero-layer") as HTMLDivElement;

/** A fixed caption that fades in while its stop is active. */
function Stop(props: StopProps) {
  const { stop, active } = props;
  const emotion = useEmotionalState(props);
  const entries = useEntries(props.active);
  const memory = useMemoryCycle(active && stop.panel === "memory");
  const { t, locale } = useLanding();
  // The hero's text sits in the stage, behind her canvas (`#hero-layer`).
  if (stop.id === "hero") return createPortal(<Hero {...props} />, heroLayer);
  const copy = stopCopy(stop, props.avatar, t);
  const light = stop.ink === "light";
  const place = {
    memory: cn(
      "md:right-[var(--gutter)] md:left-auto md:top-[13vh] md:bottom-auto",
      // The notebook's two pages need a wide column.
      "md:w-[min(34rem,40vw)]",
    ),
    emotion: "md:w-[min(26rem,29vw)]",
  }[stop.id];
  // Hidden (not just transparent) once faded, so the browser stops keeping
  // composited layers for every inactive stop.
  const fade = active
    ? "visible translate-y-0 opacity-100"
    : "pointer-events-none invisible translate-y-3 opacity-0 motion-reduce:translate-y-0";
  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 px-5 pt-24 pb-7 transition-[opacity,translate,visibility] duration-500",
          "md:inset-x-auto md:bottom-[12vh] md:left-(--rail) md:w-[min(34rem,40vw)] md:bg-none md:p-0",
          light
            ? "bg-linear-to-t from-[#3d3f8f] from-45% via-[#3d3f8f]/85 to-transparent"
            : "from-background via-background/90 bg-linear-to-t from-45% to-transparent",
          place,
          fade,
        )}
        aria-hidden={!active}
      >
        {/* Replayed each time the stop becomes active, or its text changes
            (another Avatar's pronouns, or another language). */}
        <StopCaptionText
          key={`caption-${entries}-${props.avatar.id}-${locale}`}
          locale={locale}
          title={copy.title}
          body={copy.body}
          titleClassName={cn(
            "text-3xl font-bold tracking-tight text-balance md:text-5xl",
            light ? "text-white" : "text-foreground caption-halo",
          )}
          bodyClassName={cn(
            "mt-2 max-w-[34ch] text-base md:mt-3 md:text-lg",
            light ? "text-white/80" : "text-muted-foreground caption-halo",
            stop.panel === "mascots" && "max-md:hidden",
          )}
          boldClassName={light ? "text-white" : "text-foreground"}
        />
        {/* Gesture chips play her live; the stills cannot. */}
        {stop.panel === "chips" && !props.state.fallback ? (
          <ClipChips {...props} />
        ) : null}
        {stop.panel === "mascots" ? (
          // One reaction at a time, with her emotional state as a mood bloom
          // of all 24 emotions under it.
          <div className="mt-4 w-80 max-w-full md:mt-6">
            <ReactionStepper {...props} />
            <MoodBloom
              // Opens from a bud on each arrival; pulses per reaction.
              key={`bloom-${entries}`}
              values={emotion.values}
              settled={emotion.settled}
              beat={
                props.state.playing?.stop === props.index
                  ? props.state.playing.clip
                  : null
              }
              // Smaller on phones and short screens, so the caption fits.
              className="mt-2 h-52 md:h-64 md:[@media(max-height:780px)]:h-52"
            />
          </div>
        ) : null}
        {stop.panel === "memory" ? (
          <MemoryStory avatar={props.avatar} cycle={memory} />
        ) : null}
        {stop.id === "download" ? (
          <>
            <DownloadActions />
            <SiteFooter light={light} />
          </>
        ) : null}
      </div>
    </>
  );
}

/**
 * The opening title and line. The logo already sits in the header, so the
 * line says what an Anima does; its feature words jump to their stops.
 */
function Hero({ stop, active, avatar, state, controller }: StopProps) {
  // The title and line wait for her wave, then rise in one after another.
  const revealed = state.revealed;
  const entries = useEntries(active);
  const { t, locale } = useLanding();
  const reveal = (delay: string) =>
    cn(
      "transition-[opacity,translate] duration-700 ease-out",
      revealed
        ? cn("translate-y-0 opacity-100", delay)
        : "translate-y-4 opacity-0 motion-reduce:translate-y-0",
    );
  // The stage keeps her head clear of this text, wherever it wraps.
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const report = () =>
      controller.setHeroTextBottom(
        // Layout values, so the entrance's translate does not count.
        parseFloat(getComputedStyle(element).top) + element.offsetHeight,
      );
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [controller]);
  return (
    <div
      ref={box}
      className={cn(
        "fixed inset-x-0 top-[12vh] z-30 flex justify-center px-5 text-center transition-[opacity,translate,visibility] duration-500 md:top-[14vh]",
        active
          ? "visible translate-y-0 opacity-100"
          : "pointer-events-none invisible -translate-y-3 opacity-0 motion-reduce:translate-y-0",
      )}
      aria-hidden={!active}
    >
      <div className="flex flex-col items-center">
        {/* Replayed whenever the text is revealed, the hero comes back
            into view or the language changes. */}
        <HeroText
          key={`hero-${revealed}-${entries}-${locale}`}
          copy={stopCopy(stop, avatar, t)}
          locale={locale}
          controller={controller}
          revealed={revealed}
          titleClassName={reveal("delay-0")}
        />
      </div>
    </div>
  );
}

/** How many times `active` has turned on, to replay entrances by key. */
function useEntries(active: boolean) {
  const [entries, setEntries] = useState(0);
  useEffect(() => {
    if (active) setEntries((count) => count + 1);
  }, [active]);
  return entries;
}

/**
 * Text Effect keeps the spaces between its word blocks as preserved
 * whitespace, so a wrapped line would start with one; let them collapse.
 */
const COLLAPSE_SPACES = "[&_.whitespace-pre-wrap]:whitespace-normal";

/** Seconds between one title letter's bounce and the next. */
const TITLE_STAGGER_SEC = 0.02;

/**
 * Titles bounce in letter by letter, each springing up from a slight tilt.
 * The rise is in `em`, so it scales with the text.
 */
const BOUNCE_LETTERS = {
  container: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: TITLE_STAGGER_SEC },
    },
  },
  item: {
    hidden: { opacity: 0, y: "0.25em", rotate: -8 },
    visible: {
      opacity: 1,
      y: 0,
      rotate: 0,
      transition: { type: "spring", bounce: 0.4, duration: 0.45 },
    },
  },
} satisfies TextEffectProps["variants"];

/**
 * Subtitles fade up line by line once their title has landed (Motion
 * Primitives' per-line Text Effect, on lines as they wrap): each line rises a
 * little as it fades in, the next following shortly after.
 */
const LINE_STAGGER_SEC = 0.12;
const LINE_FADE = {
  hidden: { opacity: 0, y: "0.6em" },
  visible: (line: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      ease: "easeOut",
      delay: line * LINE_STAGGER_SEC,
    },
  }),
} satisfies Variants;

/** A caption word as drawn (text, a bold run or a link), and whether a space comes before it. */
type LineWord = { node: ReactNode; space: boolean };

/**
 * Words fading in by the line they wrap onto, once `start` is on; until then
 * they hold their places, unseen. Words may be elements (bold runs, links).
 * Lines are measured after layout, so they follow the screen's wrapping.
 */
function FadeLines({
  words,
  start,
  onComplete,
}: {
  words: LineWord[];
  start: boolean;
  onComplete?: () => void;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<number[]>([]);
  useLayoutEffect(() => {
    const spans = [
      ...(root.current?.querySelectorAll<HTMLElement>(":scope > [data-word]") ??
        []),
    ];
    let line = 0;
    let top = spans[0]?.offsetTop ?? 0;
    setLines(
      spans.map((span) => {
        // A word more than a few pixels lower starts a new line.
        if (span.offsetTop > top + 4) {
          line += 1;
          top = span.offsetTop;
        }
        return line;
      }),
    );
  }, [words.length]);
  return (
    <motion.span
      ref={root}
      initial="hidden"
      animate={start ? "visible" : "hidden"}
      variants={{ hidden: {}, visible: {} }}
      onAnimationComplete={(definition) => {
        if (definition === "visible") onComplete?.();
      }}
    >
      {words.map((word, index) => (
        <Fragment key={index}>
          {index > 0 && word.space ? " " : null}
          <motion.span
            data-word=""
            custom={lines[index] ?? 0}
            variants={LINE_FADE}
            className="inline-block"
          >
            {word.node}
          </motion.span>
        </Fragment>
      ))}
    </motion.span>
  );
}

/**
 * A caption's body as words (`captionWords`): `**bold**` runs keep a
 * stronger weight and colour, and punctuation straight after a run stays
 * with its last word, as does a Japanese ending (`continuesWord`).
 */
function bodyWords(
  text: string,
  boldClassName: string,
  locale: string,
): LineWord[] {
  const words: LineWord[] = [];
  // The last word's text, for whether the next run continues it.
  let previousText = "";
  const runs = text.split("**");
  runs.forEach((run, index) => {
    const bold = index % 2 === 1;
    captionWords(run, locale).forEach((token, position) => {
      const node = bold ? (
        <strong
          key={`${index}-${position}`}
          className={cn("font-semibold", boldClassName)}
        >
          {token.text}
        </strong>
      ) : (
        token.text
      );
      // A space on either side of the `**` separates a run from the last.
      const space =
        token.space || (position === 0 && /\s$/.test(runs[index - 1] ?? ""));
      // Runs meeting without one continue the previous word where words
      // are spaced; where they are not, only punctuation and endings do.
      const previous = words.at(-1);
      const continues = unspaced(locale)
        ? continuesWord({ text: token.text, space }, previousText, locale)
        : !space;
      if (position === 0 && previous && continues) {
        words[words.length - 1] = {
          node: (
            <Fragment key={`${index}-glue`}>
              {previous.node}
              {space ? " " : null}
              {node}
            </Fragment>
          ),
          space: previous.space,
        };
        previousText += token.text;
      } else {
        words.push({ node, space });
        previousText = token.text;
      }
    });
  });
  return words;
}

/**
 * A stop's title and subtitle: the title's letters bounce in, then the
 * subtitle fades up line by line. Keyed to replay on each arrival and Avatar
 * switch.
 */
function StopCaptionText({
  locale,
  title,
  body,
  titleClassName,
  bodyClassName,
  boldClassName,
}: {
  locale: string;
  title: string;
  body: string;
  titleClassName: string;
  bodyClassName: string;
  boldClassName: string;
}) {
  const [titleDone, setTitleDone] = useState(false);
  return (
    <>
      <BouncingTitle
        text={title}
        locale={locale}
        className={titleClassName}
        onComplete={() => setTitleDone(true)}
      />
      <p className={bodyClassName}>
        <FadeLines
          words={bodyWords(body, boldClassName, locale)}
          start={titleDone}
        />
      </p>
    </>
  );
}

/** A stop's words in the active locale. */
type StopCopy = ReturnType<typeof stopCopy>;

/**
 * The hero's title and line: the title bounces in and shimmers once, and
 * the line fades up after it.
 */
function HeroText({
  copy,
  locale,
  controller,
  revealed,
  titleClassName,
}: {
  copy: StopCopy;
  locale: string;
  controller: StageController;
  revealed: boolean;
  titleClassName: string;
}) {
  const [titleDone, setTitleDone] = useState(false);
  const [lineDone, setLineDone] = useState(false);
  return (
    <>
      <HeroTitle
        text={copy.title}
        locale={locale}
        shine={revealed}
        className={titleClassName}
        onLanded={() => setTitleDone(true)}
      />
      <p className="font-hero-line text-muted-foreground mt-2 max-w-[30ch] text-[1.125rem] leading-snug text-balance md:mt-3 md:max-w-[32ch] md:text-[1.9375rem]">
        <FadeLines
          words={heroWords(copy, locale, controller, lineDone)}
          start={revealed && titleDone}
          onComplete={() => setLineDone(true)}
        />
      </p>
    </>
  );
}

/**
 * A title's entrance (Motion Primitives' Text Effect): its letters bounce up
 * one at a time from a slight tilt. `onComplete` follows the last letter.
 * Text Effect wraps only at spaces, so a Japanese or Chinese title gets one
 * per word, each starting where the letters before it leave off.
 */
function BouncingTitle({
  text,
  locale,
  as = "h2",
  className,
  onComplete,
}: {
  text: string;
  locale: string;
  as?: TextEffectProps["as"];
  className?: string;
  onComplete?: () => void;
}) {
  if (!unspaced(locale))
    return (
      <TextEffect
        as={as}
        per="char"
        variants={BOUNCE_LETTERS}
        className={cn(className, COLLAPSE_SPACES)}
        onAnimationComplete={onComplete}
      >
        {text}
      </TextEffect>
    );
  const words = captionWords(text, locale);
  let lettersBefore = 0;
  return createElement(
    as,
    { className },
    words.map((word, index) => {
      const delay = lettersBefore * TITLE_STAGGER_SEC;
      lettersBefore += word.text.length;
      return (
        <Fragment key={index}>
          {index > 0 && word.space ? " " : null}
          <TextEffect
            as="span"
            per="char"
            delay={delay}
            variants={BOUNCE_LETTERS}
            className="inline-block"
            onAnimationComplete={
              index === words.length - 1 ? onComplete : undefined
            }
          >
            {word.text}
          </TextEffect>
        </Fragment>
      );
    }),
  );
}

/**
 * The hero title: its letters bounce in, then, once every letter has
 * landed, one neutral shimmer (Motion Primitives' Text Shimmer) sweeps across
 * it and it returns to plain text. `shine` holds the shimmer back while the
 * title is still hidden behind the entrance.
 */
function HeroTitle({
  text,
  locale,
  shine,
  className,
  onLanded,
}: {
  text: string;
  locale: string;
  shine: boolean;
  className: string;
  /** Called once every letter has landed. */
  onLanded: () => void;
}) {
  const [sweeping, setSweeping] = useState(false);
  return (
    <TextShimmer
      as="h1"
      text={text}
      play={sweeping}
      repeat={0}
      duration={1.2}
      spread={3}
      onComplete={() => setSweeping(false)}
      className={cn(
        "font-hero text-[2.75rem] leading-tight md:text-[4.375rem]",
        "[--base-color:var(--foreground)] [--base-gradient-color:color-mix(in_srgb,var(--foreground)_35%,var(--background))]",
        className,
      )}
    >
      <BouncingTitle
        as="span"
        text={text}
        locale={locale}
        onComplete={() => {
          if (shine) setSweeping(true);
          onLanded();
        }}
      />
    </TextShimmer>
  );
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A hero link word as a pattern, matching whole words at a Latin letter or
 * digit (`\b` finds no boundary beside Japanese, Korean or Chinese text).
 */
const linkPattern = (word: string) =>
  `${/^\w/.test(word) ? "\\b" : ""}${escapeRegExp(word)}${/\w$/.test(word) ? "\\b" : ""}`;

/**
 * The hero line as words, its link words as coloured buttons to their stops
 * (each keeping the punctuation after it). Once `waving`, a light wave runs
 * through the link words' letters in reading order, then rests.
 */
function heroWords(
  { body: text, links }: StopCopy,
  locale: string,
  controller: StageController,
  waving: boolean,
): LineWord[] {
  const plain = (part: string): LineWord[] =>
    captionWords(part, locale).map(({ text, space }) => ({
      node: text,
      space,
    }));
  if (links.length === 0) return plain(text);
  const pattern = new RegExp(
    `(${links.map(({ word }) => linkPattern(word)).join("|")})([,.;:!?、，。！？]?)`,
  );
  const parts = text.split(pattern);
  // split() returns text, word, punctuation, text, ...
  const letterCount = parts
    .filter((_, index) => index % 3 === 1)
    .reduce((sum, word) => sum + word.length, 0);
  const cycle =
    (letterCount - 1) * LETTER_STAGGER_MS + LETTER_WAVE_MS + WAVE_REST_MS;
  let lettersBefore = 0;
  return parts.flatMap((part, index): LineWord[] => {
    if (index % 3 === 0) return plain(part);
    if (index % 3 === 2) return [];
    const link = links.find(({ word }) => word === part)!;
    const target = STAGE_STOPS.findIndex(({ id }) => id === link.stop);
    const waveAt = FIRST_WAVE_MS + lettersBefore * LETTER_STAGGER_MS;
    lettersBefore += part.length;
    return [
      {
        node: (
          <span key={index}>
            <WavingLink
              word={part}
              color={STAGE_STOPS[target].accent}
              onClick={() => controller.scrollToStop(target)}
              waveAt={waving ? waveAt : null}
              waveCycle={cycle}
            />
            {parts[index + 1]}
          </span>
        ),
        space: /\s$/.test(parts[index - 1]),
      },
    ];
  });
}

const LETTER_WAVE_MS = 680;
const LETTER_STAGGER_MS = 45;
/** The pause after the hero line lands before its first wave. */
const FIRST_WAVE_MS = 600;
/** The rest between one wave leaving the last letter and the next. */
const WAVE_REST_MS = 2500;

/**
 * One letter's light bob, then its rest until the next wave, as Web
 * Animations keyframes over a whole cycle.
 */
function waveKeyframes(cycleMs: number): Keyframe[] {
  const share = LETTER_WAVE_MS / cycleMs;
  return [
    { translate: "0 0", offset: 0, easing: "cubic-bezier(0.33, 0, 0.2, 1)" },
    {
      translate: "0 -0.14em",
      offset: 0.42 * share,
      easing: "cubic-bezier(0.5, 0, 0.5, 1)",
    },
    {
      translate: "0 0.03em",
      offset: 0.78 * share,
      easing: "cubic-bezier(0.4, 0, 0.6, 1)",
    },
    { translate: "0 0", offset: share },
    { translate: "0 0", offset: 1 },
  ];
}

/**
 * A hero link word that lifts on hover and, while `waveAt` is set, keeps a
 * light wave running through its letters: each cycle its first letter rises
 * `waveAt` ms in and the rest follow one after another.
 */
function WavingLink({
  word,
  color,
  onClick,
  waveAt,
  waveCycle,
}: {
  word: string;
  color: string;
  onClick: () => void;
  waveAt: number | null;
  waveCycle: number;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const letters = button.current?.querySelectorAll("[data-letter]");
    if (waveAt === null || !letters) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const keyframes = waveKeyframes(waveCycle);
    const runs = [...letters].map((letter, index) =>
      letter.animate(keyframes, {
        duration: waveCycle,
        delay: waveAt + index * LETTER_STAGGER_MS,
        iterations: Infinity,
      }),
    );
    return () => runs.forEach((run) => run.cancel());
  }, [waveAt, waveCycle]);
  return (
    <button
      ref={button}
      type="button"
      onClick={onClick}
      aria-label={word}
      style={{ color }}
      className="hero-link focus-visible:ring-ring cursor-pointer rounded-md outline-none focus-visible:ring-2"
    >
      {[...word].map((letter, index) => (
        <span
          key={index}
          data-letter=""
          aria-hidden="true"
          className="inline-block"
        >
          {letter}
        </span>
      ))}
    </button>
  );
}

const NEUTRAL_STATE = Object.fromEntries(
  TRACKED_EMOTIONS.map((emotion) => [emotion, 0]),
) as Record<TrackedEmotion, number>;
const EMOTION_EASE_MS = 900;

/**
 * The made-up emotional state of the clip playing at this stop: `values`
 * eased from the previous state so the bloom glides between feelings, and
 * `settled`, the state they are easing toward.
 */
function useEmotionalState({ stop, index, state, avatar }: StopProps) {
  const clip =
    state.playing?.stop === index
      ? stopClips(stop, avatar.id)[state.playing.clip]
      : null;
  const target = clip?.emotion;
  const settled = useMemo(() => ({ ...NEUTRAL_STATE, ...target }), [target]);
  const [values, setValues] = useState(NEUTRAL_STATE);
  const shown = useRef(values);
  useEffect(() => {
    if (stop.panel !== "mascots") return;
    const from = shown.current;
    const to = settled;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / EMOTION_EASE_MS);
      const eased = 1 - (1 - t) ** 3;
      const next = { ...to };
      for (const emotion of TRACKED_EMOTIONS)
        next[emotion] = from[emotion] + (to[emotion] - from[emotion]) * eased;
      shown.current = next;
      setValues(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [stop.panel, settled]);
  return { values, settled };
}

/**
 * The Emotions stop's reactions one at a time, in one pill: the name of the
 * one playing between borderless buttons that play the previous and next.
 * The stop keeps cycling through them on its own, and the name follows
 * whichever is playing.
 */
function ReactionStepper({
  stop,
  index,
  state,
  avatar,
  controller,
}: StopProps) {
  const clips = stopClips(stop, avatar.id);
  const { t } = useLanding();
  const clipLabel = useClipLabel();
  const playing = state.playing?.stop === index ? state.playing.clip : null;
  // The last reaction played stays shown in the moment between two clips.
  const [current, setCurrent] = useState(0);
  if (playing !== null && playing !== current) setCurrent(playing);
  const play = (offset: number) => {
    const next = (current + offset + clips.length) % clips.length;
    setCurrent(next);
    controller.playClip(index, next);
  };
  const step = cn(
    "text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:ring-ring flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2",
    // A slightly larger target on phones.
    "max-md:size-9",
  );
  return (
    <div className="bg-card/85 mx-auto flex w-fit items-center gap-1 rounded-full border p-1 shadow-xs">
      <button
        type="button"
        aria-label={t("page.previousReaction")}
        className={step}
        onClick={() => play(-1)}
      >
        <ChevronsLeft aria-hidden="true" className="size-4" />
      </button>
      {/* Wide enough for the longest name, so the pill keeps its size. */}
      <span
        key={current}
        aria-live="polite"
        className="reaction-in min-w-28 text-center text-sm font-medium"
      >
        {clipLabel(clips[current])}
      </span>
      <button
        type="button"
        aria-label={t("page.nextReaction")}
        className={step}
        onClick={() => play(1)}
      >
        <ChevronsRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

/**
 * A clip's label: a Reaction's feeling from the app's `emotion` catalog,
 * else the landing catalog's `clips.<stem>`.
 */
function useClipLabel() {
  const { t } = useLanding();
  const { t: emotionT } = useTranslation("emotion");
  return (clip: StageClip) =>
    clip.feeling
      ? emotionT(`emotions.${clip.feeling}`)
      : t(`clips.${clip.stem}` as LandingKey);
}

/** Mascot or text chips for a stop's clips; the playing one is marked. */
function ClipChips({ stop, index, state, avatar, controller }: StopProps) {
  const clipLabel = useClipLabel();
  const playing = state.playing?.stop === index ? state.playing.clip : null;
  return (
    <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:mt-6 md:flex-wrap md:overflow-visible md:px-0">
      {stopClips(stop, avatar.id).map((clip, clipIndex) => (
        <button
          key={clip.spec}
          type="button"
          aria-pressed={playing === clipIndex}
          onClick={() => controller.playClip(index, clipIndex)}
          className={cn(
            "bg-card/85 focus-visible:ring-ring focus-visible:ring-offset-background inline-flex shrink-0 items-center gap-2 rounded-full border text-sm font-medium shadow-xs transition outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            clip.mascot ? "py-1 pr-3.5 pl-1" : "px-3.5 py-1.5",
            playing === clipIndex
              ? "border-ring bg-primary/25 ring-ring/50 ring-2"
              : "hover:bg-card border-border",
          )}
        >
          {clip.mascot ? (
            <img
              src={`/emotions/${clip.mascot}`}
              alt=""
              className="size-8 object-contain"
            />
          ) : null}
          {clipLabel(clip)}
        </button>
      ))}
    </div>
  );
}

/** Each page's ribbon colour in the notebook. */
const NOTE_COLORS: Record<MemoryNote, string> = {
  profile: "#8fd3f4",
  identity: "#c9b6ff",
  memories: "#ffadd0",
};

/** One of the Markdown notes memory is built from, as the demo shows it. */
type MemoryFile = {
  id: MemoryNote;
  file: string;
  /** The page's name in the Anima's notebook. */
  name: string;
  /**
   * `fresh` is the line the chat adds; `voice` marks the section the reply
   * is written from.
   */
  sections: {
    heading: string;
    lines: string[];
    fresh?: string;
    voice?: boolean;
  }[];
};

/**
 * The three built-in notes, each with the change its chat makes: the kitten
 * is a fact about the owner, so it lands in PROFILE.md; the reply's voice
 * comes from IDENTITY.md, which chat never edits; the promise to follow up
 * is the relationship's, so the Anima files it in its own MEMORIES.md.
 */
const memoryFiles = (avatar: StageAvatar, t: LandingT): MemoryFile[] => {
  const identity = (section: "essence" | "speakingStyle") => ({
    heading: t(
      `avatars.${avatar.id}.identity.${section}.heading` as LandingKey,
    ),
    lines: [t(`avatars.${avatar.id}.identity.${section}.line` as LandingKey)],
    voice: section === "speakingStyle",
  });
  return [
    {
      id: "profile",
      file: "PROFILE.md",
      name: t("memory.pages.profile"),
      sections: [
        {
          heading: t("memory.profile.basics"),
          lines: [t("memory.profile.basicsLine")],
        },
        {
          heading: t("memory.profile.people"),
          lines: [t("memory.profile.peopleLine")],
          fresh: t("memory.profile.peopleNew"),
        },
      ],
    },
    {
      id: "identity",
      file: "IDENTITY.md",
      name: t("memory.pages.identity"),
      // The voice a reply speaks in leads its page.
      sections: [identity("speakingStyle"), identity("essence")],
    },
    {
      id: "memories",
      file: "MEMORIES.md",
      name: t("memory.pages.memories"),
      sections: [
        {
          heading: t("memory.memories.story"),
          lines: [t("memory.memories.storyLine")],
        },
        {
          heading: t("memory.memories.threads"),
          lines: [t("memory.memories.threadsLine")],
          fresh: t("memory.memories.threadsNew"),
        },
      ],
    },
  ];
};
/** The order the pages cycle in: profile, identity, then memories. */
const MEMORY_FILE_ORDER: MemoryNote[] = ["profile", "identity", "memories"];
/**
 * When the visitor's line, the reply's three-dot wait, the reply, and then
 * its "Memory updated" cue together with the page's change appear (ms).
 */
const MEMORY_CHAT_STEPS = [400, 1000, 2400, 3200];
/**
 * How long a page shows while cycling on their own: until its change has
 * finished writing itself in (the last step plus the 1.2 s write-in), then
 * a moment to read it.
 */
const MEMORY_FILE_MS = MEMORY_CHAT_STEPS[3] + 1200 + 2000;
/** The app's chat bubbles, compacted for the demo card. */
const CHAT_BUBBLE = "max-w-[85%] px-3.5 py-2 text-sm";

/**
 * The memory stop's shared clock: the page on show (cycling every
 * `MEMORY_FILE_MS` until the visitor picks one) and how far its chat has
 * played. Each time a page opens it starts from before its chat's change.
 */
function useMemoryCycle(active: boolean) {
  const [note, setNote] = useState<MemoryNote>("profile");
  const [touched, setTouched] = useState(false);
  const step = useSteps(active, MEMORY_CHAT_STEPS, note);
  const changed = step >= 4;

  useEffect(() => {
    setNote("profile");
    setTouched(false);
  }, [active]);

  useEffect(() => {
    if (!active || touched) return;
    const timer = window.setTimeout(() => {
      const index = MEMORY_FILE_ORDER.indexOf(note);
      setNote(MEMORY_FILE_ORDER[(index + 1) % MEMORY_FILE_ORDER.length]);
    }, MEMORY_FILE_MS);
    return () => window.clearTimeout(timer);
  }, [active, touched, note]);

  return {
    active,
    note,
    step,
    changed,
    touched,
    pick: (next: MemoryNote) => {
      setTouched(true);
      setNote(next);
    },
  };
}
type MemoryCycle = ReturnType<typeof useMemoryCycle>;

/**
 * The memory feature as it works in the app, one note at a time: a chat
 * line, the reply (after the chat's three-dot wait) and its "Memory updated"
 * cue as the note changes (IDENTITY.md only lights up the voice the reply
 * speaks in), above the Anima's notebook open at that note's page.
 */
function MemoryStory({
  avatar,
  cycle,
}: {
  avatar: StageAvatar;
  cycle: MemoryCycle;
}) {
  return (
    <div className="mt-5 space-y-3 text-left">
      <MemoryChat avatar={avatar} cycle={cycle} />
      <MemoryNotebook avatar={avatar} cycle={cycle} />
    </div>
  );
}

/**
 * The app's own chat bubbles: the visitor's line, then the reply. A thin
 * line along the bottom fills until the next page while they cycle.
 */
function MemoryChat({
  avatar,
  cycle,
}: {
  avatar: StageAvatar;
  cycle: MemoryCycle;
}) {
  const { note, step, changed } = cycle;
  return (
    <div className="bg-card/95 text-card-foreground relative hidden overflow-hidden rounded-2xl border p-3.5 shadow-xl md:block">
      {/* Every exchange, played out and invisible, in one grid cell under
          the live one, so the card keeps the tallest one's height and the
          notebook below never moves. */}
      <div className="grid">
        {MEMORY_FILE_ORDER.map((sizer) => (
          <ChatExchange
            key={sizer}
            avatar={avatar}
            note={sizer}
            step={MEMORY_CHAT_STEPS.length}
            sizer
          />
        ))}
        <ChatExchange
          avatar={avatar}
          note={note}
          step={step}
          changed={changed}
        />
      </div>
      {/* Time until the next page: a bar in the open page's ribbon colour
          on a faint track. */}
      {cycle.active && !cycle.touched ? (
        <span
          aria-hidden="true"
          className="bg-foreground/10 absolute inset-x-0 bottom-0 h-1.5"
        >
          <span
            key={note}
            className="absolute inset-0 origin-left rounded-r-full"
            style={{
              background: NOTE_COLORS[note],
              animation: `landing-progress ${MEMORY_FILE_MS}ms linear forwards`,
            }}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * One note's exchange, shown up to `step` of `MEMORY_CHAT_STEPS`; a `sizer`
 * is the invisible, fully played copy that holds the card's height.
 */
function ChatExchange({
  avatar,
  note,
  step,
  changed = step >= MEMORY_CHAT_STEPS.length,
  sizer = false,
}: {
  avatar: StageAvatar;
  note: MemoryNote;
  step: number;
  changed?: boolean;
  sizer?: boolean;
}) {
  const { t } = useLanding();
  const chat = {
    user: t(`memory.user.${note}`),
    reply: t(`avatars.${avatar.id}.replies.${note}` as LandingKey),
  };
  return (
    <div
      className={cn("col-start-1 row-start-1", sizer && "invisible")}
      aria-hidden={sizer || undefined}
    >
      <Reveal shown={step >= 1}>
        <Message from="user" className="py-0">
          <MessageContent from="user" className={CHAT_BUBBLE}>
            {chat.user}
          </MessageContent>
        </Message>
      </Reveal>
      <Reveal shown={step >= 2} className="mt-2.5">
        <Message from="assistant" className="py-0">
          <div className="flex max-w-[85%] flex-col items-start">
            <MessageContent
              key={`${note}-${step >= 3}`}
              from="assistant"
              animateOnEnter={!sizer && step >= 3}
              className={cn(CHAT_BUBBLE, "max-w-full")}
            >
              {step >= 3 ? chat.reply : <MessageLoaderV2 className="h-5" />}
            </MessageContent>
            {note === "identity" ? null : (
              <Reveal
                shown={changed}
                className="text-muted-foreground mt-1 ml-1 inline-flex items-center gap-1.5 text-xs"
              >
                <Brain aria-hidden="true" className="size-3.5" />
                {t("memory.updated")}
              </Reveal>
            )}
          </div>
          <img
            src={PROGRAM.portraits[avatar.id]}
            alt={sizer ? "" : avatar.name}
            className="bg-muted ring-border size-7 shrink-0 self-start rounded-full object-cover ring-1"
          />
        </Message>
      </Reveal>
    </div>
  );
}

/**
 * The Anima's notebook, open at the note's page. The left page says, in the
 * Anima's own words, what the page is for; the right page holds the note,
 * where a new memory writes itself in by hand and the voice a reply speaks
 * in gets a highlighter stroke. Ribbon bookmarks along the top turn to the
 * other pages, and the cover takes the open page's ribbon colour.
 */
function MemoryNotebook({
  avatar,
  cycle,
}: {
  avatar: StageAvatar;
  cycle: MemoryCycle;
}) {
  const { t } = useLanding();
  const files = memoryFiles(avatar, t);
  const file = files.find(({ id }) => id === cycle.note)!;
  return (
    <div>
      <div className="relative pt-8">
        {/* Ribbons tucked under the cover, the open page's raised. */}
        <div className="absolute top-0 right-5 flex items-start gap-1.5">
          {files.map((page) => (
            <button
              key={page.id}
              type="button"
              aria-pressed={page.id === cycle.note}
              aria-label={t("memory.ribbon", {
                page: page.name,
                file: page.file,
              })}
              title={t("memory.openFile", { file: page.file })}
              onClick={() => cycle.pick(page.id)}
              className={cn(
                "font-hand h-9 cursor-pointer rounded-t-md px-2.5 pt-1.5 text-[1rem] leading-none whitespace-nowrap text-[#2e2b36] shadow-sm transition-[translate,filter,box-shadow] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#2e2b36]",
                page.id === cycle.note
                  ? "-translate-y-1"
                  : "translate-y-0.5 opacity-90 hover:-translate-y-0.5 hover:opacity-100 hover:shadow-md hover:brightness-105",
              )}
              style={{ background: NOTE_COLORS[page.id] }}
            >
              {page.name}
            </button>
          ))}
        </div>
        <div
          className="relative z-10 rounded-[14px] p-1.5 shadow-xl transition-colors duration-500"
          style={{ background: NOTE_COLORS[cycle.note] }}
        >
          <div className="notebook-paper relative grid min-h-[13rem] grid-cols-1 overflow-hidden rounded-[10px] text-[#2e2b36] [perspective:1400px] md:grid-cols-2">
            <div className="border-black/10 px-4 pt-3 pb-3 max-md:border-b md:border-r md:pb-4">
              <p className="font-hand text-[1.45rem] leading-[26px]">
                {file.file}
              </p>
              <p className="font-hand mt-[26px] text-[1.05rem] leading-[26px] max-md:mt-0">
                {t(`avatars.${avatar.id}.notebook.${file.id}` as LandingKey)}
              </p>
            </div>
            <div className="px-4 pt-3 pb-4">
              {file.sections.map((section) => (
                <div key={section.heading}>
                  <p className="text-[11px] leading-[26px] font-semibold tracking-wide text-[#2e2b36]/80 uppercase">
                    {section.heading}
                  </p>
                  {section.lines.map((line) => (
                    <p
                      key={line}
                      className={cn(
                        "font-hand text-[1.05rem] leading-[26px]",
                        section.voice && "notebook-highlight",
                      )}
                      data-shown={section.voice && cycle.changed}
                    >
                      {line}
                    </p>
                  ))}
                  {section.fresh ? (
                    <p
                      className="write-in font-hand text-[1.05rem] leading-[26px] text-[#3a5bd9]"
                      data-shown={cycle.changed}
                    >
                      {section.fresh}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {/* The page turning over to the one now open. */}
            <div
              key={cycle.note}
              aria-hidden="true"
              className="page-turn notebook-paper absolute inset-y-0 right-0 hidden w-1/2 md:block"
            />
          </div>
        </div>
      </div>
      <p className="mt-2.5 text-xs text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.5)]">
        {t("memory.hint")}
      </p>
    </div>
  );
}

/**
 * Step through `delays` (ms from activation, or from each new `replay`)
 * while `active`; 0 when not.
 */
function useSteps(active: boolean, delays: number[], replay?: unknown) {
  // Steps belong to the `replay` they were reached for, so the first render
  // after a new one already reads 0 instead of the previous run's last step.
  const [reached, setReached] = useState({ replay, step: 0 });
  useEffect(() => {
    setReached({ replay, step: 0 });
    if (!active) return;
    const timers = delays.map((delay, index) =>
      window.setTimeout(() => setReached({ replay, step: index + 1 }), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // The delays are fixed for each caller; a new `replay` starts over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, replay]);
  return active && reached.replay === replay ? reached.step : 0;
}

function Reveal({
  shown,
  className,
  children,
}: {
  shown: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "transition-[opacity,translate,visibility] duration-500",
        shown
          ? "translate-y-0 opacity-100"
          : "translate-y-1.5 opacity-0 motion-reduce:translate-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The page footer under the last stop's actions: the pages Cloud publishes
 * beside this one, the contact address, the docs and the third-party
 * notices, then the copyright line beside Animama's social icons.
 */
function SiteFooter({ light }: { light: boolean }) {
  const { t } = useLanding();
  const linkClass = cn(
    "rounded-sm outline-none focus-visible:ring-2",
    focusRing(light),
    light ? "hover:text-white" : "hover:text-foreground",
  );
  return (
    <footer
      className={cn(
        "mt-8 text-xs",
        light ? "text-white/70" : "text-muted-foreground",
      )}
    >
      <nav aria-label={t("footer.label")}>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {FOOTER_LINKS.map(({ key, href }) => (
            <li key={key}>
              <a
                href={href}
                className={cn(linkClass, "underline-offset-2 hover:underline")}
              >
                {t(`footer.${key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <p>{SITE.copyright}</p>
        <ul className="flex items-center gap-3">
          {SITE.social.map(({ label, href, icon }) => (
            <li key={label} className="flex">
              <a
                href={href}
                aria-label={label}
                title={label}
                className={linkClass}
              >
                <SocialIcon name={icon} className="size-4" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}

/**
 * The last stop's actions: Download (the download page) and the docs; during
 * the closed beta, Request Beta Access in Download's place.
 */
function DownloadActions() {
  const { t } = useLanding();
  if (CLOSED_BETA)
    return (
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <Button asChild className="group rounded-full">
          <a href={BETA_ACCESS_URL} target="_blank" rel="noreferrer">
            {t("header.requestBetaAccess")}
            <ArrowUpRight
              aria-hidden="true"
              className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
        </Button>
        <Button asChild variant="outline" className="rounded-full">
          <a href={DOCS_URL}>
            <BookOpen aria-hidden="true" />
            {t("page.readDocs")}
          </a>
        </Button>
      </div>
    );
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2.5">
      <Button asChild className="group rounded-full">
        <a href={SITE.download}>
          {t("header.download")}
          <ArrowRight
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5"
          />
        </a>
      </Button>
      <Button asChild variant="outline" className="rounded-full">
        <a href={DOCS_URL}>
          <BookOpen aria-hidden="true" />
          {t("page.readDocs")}
        </a>
      </Button>
    </div>
  );
}
