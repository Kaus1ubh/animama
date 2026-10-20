import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { i18n as I18nInstance } from "i18next";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Apple,
  ArrowRight,
  Bird,
  BookOpen,
  Brain,
  FileText,
  Flower2,
  Heart,
  Moon,
  Monitor,
  PartyPopper,
  Sparkles,
  Star,
  Sun,
} from "lucide-react";

import { AnimamaI18nProvider } from "@animama/product-ui/i18n";
import {
  SUPPORTED_LOCALES,
  localeNativeName,
  type UiLocale,
} from "@animama/runtime-contracts/locale";

import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";
import {
  EmotionSummary,
  EmotionalState,
} from "@/ui/components/emotional-state";
import { Switch } from "@/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";

import type { CreatorState, StageController, StageState } from "./controller";
import { LocaleFlag } from "./flags";
import {
  CREATOR_LAYERS,
  CREATOR_PALETTES,
  CREATOR_PARTICLES,
  STAGE_ANIMA_NAME,
  STAGE_STOPS,
  type CreatorParticleId,
  type StageStop,
} from "./stops";

/*
 * The landing page's DOM layer over the 3D stage: header, progress, one
 * scroll section per stop with its caption, and each stop's demo (emotion
 * mascots, gesture chips, the memory story and the effect creator). Built
 * from the app's own components and theme tokens.
 */

const DOCS_URL = "https://docs.animama.ai/";
const PARTICLE_ICONS: Record<CreatorParticleId, typeof Heart> = {
  hearts: Heart,
  sparkles: Sparkles,
  flowers: Flower2,
  confetti: PartyPopper,
  stars: Star,
  butterflies: Bird,
};

type StopProps = {
  stop: StageStop;
  index: number;
  active: boolean;
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
        <Overlay controller={controller} />
      </AnimamaI18nProvider>,
    ),
  );
}

function Overlay({ controller }: { controller: StageController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const active = Math.max(0, state.active);
  const light = STAGE_STOPS[active].ink === "light";
  return (
    <>
      <Header light={light} controller={controller} />
      <ProgressThread
        active={active}
        light={light}
        revealed={state.revealed}
        controller={controller}
      />
      <main>
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
 * Where the visitor is: a thin vertical thread that fills as the page
 * scrolls, the caring mascot riding its tip, and the stop counter and name
 * beside it. Each stop is a dot on the thread that scrolls to it; a ring
 * ripples out from a stop's dot as the visitor arrives.
 */
function ProgressThread({
  active,
  light,
  revealed,
  controller,
}: {
  active: number;
  light: boolean;
  /** Hidden until the hero entrance reaches her wave. */
  revealed: boolean;
  controller: StageController;
}) {
  const progress = useScrollProgress();
  const last = STAGE_STOPS.length - 1;
  const at = (share: number) => `${share * 100}%`;
  const count = (value: number) => String(value).padStart(2, "0");
  return (
    <nav
      aria-label="Features"
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
          aria-label={stop.title}
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
              {stop.label}
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
            {STAGE_STOPS[active].label}
          </span>
        </span>
      </div>
    </nav>
  );
}

/**
 * The site header: the logo on the left; on the right one liquid-glass pill
 * holding Home, About (both scroll the tour) and Docs, the theme toggle and
 * language picker, Log in and Sign up (placeholders until accounts exist),
 * and Download as its one solid button. A single soft highlight glides to
 * whichever item the pointer is over. Below 1024px only the logo and
 * Download remain.
 */
function Header({
  light,
  controller,
}: {
  light: boolean;
  controller: StageController;
}) {
  const pill = useRef<HTMLElement>(null);
  const [glow, setGlow] = useState<{ x: number; w: number } | null>(null);
  /** Move the highlight to the item under the pointer (or keyboard focus). */
  const track = (event: { target: EventTarget }) => {
    const item = (event.target as HTMLElement).closest("[data-pill-item]");
    const box = pill.current?.getBoundingClientRect();
    if (!item || !box) return;
    const rect = item.getBoundingClientRect();
    setGlow({ x: rect.left - box.left, w: rect.width });
  };
  const link = cn(
    "relative z-10 cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
    light
      ? "text-white/80 hover:text-white"
      : "text-foreground/65 hover:text-foreground",
  );
  const divider = (
    <span
      aria-hidden="true"
      className={cn(
        "mx-1.5 h-4 w-px",
        light ? "bg-white/25" : "bg-foreground/15",
      )}
    />
  );
  const download = (className: string) => (
    <Button
      data-pill-item=""
      className={cn("group relative z-10 rounded-full", className)}
      onClick={() => controller.scrollToStop(STAGE_STOPS.length - 1)}
    >
      Download
      <ArrowRight
        aria-hidden="true"
        className="transition-transform group-hover:translate-x-0.5"
      />
    </Button>
  );
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 md:px-10 md:py-5">
      <Wordmark light={light} />
      <nav
        ref={pill}
        aria-label="Site"
        data-ink={light ? "light" : "dark"}
        onPointerOver={track}
        onFocus={track}
        onPointerLeave={() => setGlow(null)}
        onBlur={() => setGlow(null)}
        className="liquid-glass relative hidden items-center gap-0.5 rounded-full p-1 lg:flex"
      >
        <span
          aria-hidden="true"
          className={cn(
            "pill-glow pointer-events-none absolute inset-y-1 left-0 rounded-full",
            glow ? "opacity-100" : "opacity-0",
          )}
          style={
            glow ? { translate: `${glow.x}px 0`, width: glow.w } : undefined
          }
        />
        <button
          type="button"
          data-pill-item=""
          className={link}
          onClick={() => controller.scrollToStop(0)}
        >
          Home
        </button>
        <button
          type="button"
          data-pill-item=""
          className={link}
          onClick={() => controller.scrollToStop(1)}
        >
          About
        </button>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          data-pill-item=""
          className={link}
        >
          Docs
        </a>
        {divider}
        <ThemeToggle light={light} />
        <LanguagePicker />
        {divider}
        <button type="button" data-pill-item="" className={link}>
          Log in
        </button>
        <button type="button" data-pill-item="" className={link}>
          Sign up
        </button>
        {download("ml-1 hover:brightness-105")}
      </nav>
      {download("lg:hidden")}
    </header>
  );
}

const THEME_KEY = "landing-stage-theme";

/**
 * Light and dark mode, using the app's own `.dark` theme. The choice is
 * remembered in this browser (`index.html` applies it before first paint).
 */
function ThemeToggle({ light }: { light: boolean }) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Private windows may refuse storage; the toggle still works.
    }
    setDark(next);
  };
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      data-pill-item=""
      className={cn(
        "focus-visible:ring-ring relative z-10 flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2",
        light
          ? "text-white/80 hover:text-white"
          : "text-foreground/65 hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Language menu: the current locale's flag, opening a list of the app's UI
 * Locales by flag and their own names. The landing copy is English-only for
 * now, so a choice is only remembered for the menu.
 */
function LanguagePicker() {
  const [locale, setLocale] = useState<UiLocale>("en");
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-pill-item=""
        className="focus-visible:ring-ring relative z-10 flex size-8 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2"
        aria-label={`Language: ${localeNativeName(locale)}`}
      >
        <LocaleFlag locale={locale} className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50 min-w-44">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => setLocale(value as UiLocale)}
        >
          {SUPPORTED_LOCALES.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              lang={option}
              className="gap-2.5"
            >
              <LocaleFlag locale={option} className="size-4" />
              {localeNativeName(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The app's logo: speech-bubble mark and rounded wordmark. */
function Wordmark({ light }: { light: boolean }) {
  return (
    <span className="flex items-center gap-2" aria-label="Animama">
      <img
        src="/brand/animama-mark.png"
        alt=""
        className="size-10 md:size-12"
      />
      <span
        aria-hidden="true"
        className={cn(
          "block h-9 w-[108px] transition-colors duration-500 md:h-11 md:w-[132px]",
          light ? "bg-white" : "bg-foreground",
        )}
        style={wordmarkMask}
      />
    </span>
  );
}

const wordmarkMask = {
  maskImage: "url(/brand/animama-wordmark.png)",
  maskSize: "contain",
  maskPosition: "center",
  maskRepeat: "no-repeat",
} as const;

/** A fixed caption that fades in while its stop is active. */
function Stop(props: StopProps) {
  const { stop, active, controller } = props;
  const creator = useCreator(active && stop.panel === "creator", controller);
  const emotion = useEmotionalState(props);
  if (stop.id === "hero") return <Hero {...props} />;
  const light = stop.ink === "light";
  const place = {
    memory:
      "md:right-[var(--gutter)] md:left-auto md:top-[13vh] md:bottom-auto md:w-[min(27rem,34vw)]",
    effects: "md:top-[13vh] md:bottom-auto md:w-[min(24rem,30vw)]",
    emotion: "md:w-[min(26rem,29vw)]",
  }[stop.id];
  const fade = active
    ? "translate-y-0 opacity-100"
    : "pointer-events-none translate-y-3 opacity-0";
  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 px-5 pt-24 pb-7 transition-[opacity,translate] duration-500",
          "md:inset-x-auto md:bottom-[12vh] md:left-(--rail) md:w-[min(34rem,40vw)] md:bg-none md:p-0",
          light
            ? "bg-linear-to-t from-[#3d3f8f] from-45% via-[#3d3f8f]/85 to-transparent"
            : "from-background via-background/90 bg-linear-to-t from-45% to-transparent",
          place,
          fade,
        )}
        aria-hidden={!active}
      >
        <h2
          className={cn(
            "text-3xl font-bold tracking-tight text-balance md:text-5xl",
            light ? "text-white" : "text-foreground caption-halo",
          )}
        >
          {stop.title}
        </h2>
        <p
          className={cn(
            "mt-2 max-w-[34ch] text-base md:mt-3 md:text-lg",
            light ? "text-white/80" : "text-muted-foreground caption-halo",
            stop.panel === "mascots" && "max-md:hidden",
          )}
        >
          {stop.body}
        </p>
        {stop.panel === "mascots" ? (
          <EmotionSummary
            emotionalState={emotion}
            className="bg-card/90 mt-3 rounded-2xl border p-3 text-sm backdrop-blur md:hidden"
          />
        ) : null}
        {stop.panel === "mascots" || stop.panel === "chips" ? (
          <ClipChips {...props} />
        ) : null}
        {stop.panel === "memory" ? <MemoryStory active={active} /> : null}
        {stop.panel === "creator" ? (
          <>
            <SceneCard {...creator} />
            <ParticleCard {...creator} className="mt-3 md:hidden" />
          </>
        ) : null}
        {stop.id === "download" ? <DownloadActions /> : null}
      </div>
      {stop.panel === "mascots" ? (
        <div
          className={cn(
            "bg-card/95 text-card-foreground fixed top-[14vh] right-[var(--gutter)] z-30 hidden w-[21rem] rounded-2xl border p-4 shadow-xl backdrop-blur transition-[opacity,translate] duration-500 md:block",
            fade,
          )}
        >
          <p className="text-muted-foreground mb-3 text-xs font-medium">
            {STAGE_ANIMA_NAME}&apos;s emotional state
          </p>
          <EmotionalState emotionalState={emotion} variant="compact" />
        </div>
      ) : null}
      {stop.panel === "creator" ? (
        <ParticleCard
          {...creator}
          className={cn(
            "fixed top-[30vh] right-[var(--gutter)] z-30 hidden w-[15rem] transition-[opacity,translate] duration-500 md:block",
            fade,
          )}
        />
      ) : null}
    </>
  );
}

/**
 * The opening title and line. The logo already sits in the header, so the
 * line says what an Anima does; its feature words jump to their stops.
 */
function Hero({ stop, active, state, controller }: StopProps) {
  // The title and line wait for her wave, then rise in one after another.
  const revealed = state.revealed;
  const reveal = (delay: string) =>
    cn(
      "transition-[opacity,translate] duration-700 ease-out",
      revealed
        ? cn("translate-y-0 opacity-100", delay)
        : "translate-y-4 opacity-0",
    );
  return (
    <div
      className={cn(
        "fixed inset-x-0 top-[12vh] z-30 flex justify-center px-5 text-center transition-[opacity,translate] duration-500 md:top-[14vh]",
        active
          ? "translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-3 opacity-0",
      )}
      aria-hidden={!active}
    >
      <div className="flex flex-col items-center">
        <h1
          className={cn(
            "font-hero text-foreground text-[2.75rem] leading-tight md:text-[4.375rem]",
            reveal("delay-0"),
          )}
        >
          {stop.title}
        </h1>
        <p
          className={cn(
            "font-hero-line text-muted-foreground mt-2 max-w-[22ch] text-[1.375rem] leading-snug text-balance md:mt-3 md:max-w-none md:text-[1.9375rem]",
            reveal("delay-300"),
          )}
        >
          <LinkedText stop={stop} controller={controller} />
        </p>
      </div>
    </div>
  );
}

/** A stop's body with its link words as coloured buttons to their stops. */
function LinkedText({
  stop,
  controller,
}: {
  stop: StageStop;
  controller: StageController;
}) {
  const text = stop.body ?? "";
  const links = stop.links ?? [];
  if (links.length === 0) return text;
  // A link keeps the punctuation after it on its line.
  const pattern = new RegExp(
    `\\b(${links.map(({ word }) => word).join("|")})\\b([,.;:]?)`,
  );
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    // split() returns text, word, punctuation, text, ...
    if (index % 3 === 0) return part;
    if (index % 3 === 2) return null;
    const link = links.find(({ word }) => word === part)!;
    const target = STAGE_STOPS.findIndex(({ id }) => id === link.stop);
    return (
      <span key={index} className="whitespace-nowrap">
        <WavingLink
          word={part}
          color={STAGE_STOPS[target].accent}
          onClick={() => controller.scrollToStop(target)}
        />
        {parts[index + 1]}
      </span>
    );
  });
}

/** One letter's bob in the wave, as Web Animations keyframes. */
const LETTER_WAVE: Keyframe[] = [
  { translate: "0 0", easing: "cubic-bezier(0.33, 0, 0.2, 1)" },
  {
    translate: "0 -0.32em",
    offset: 0.42,
    easing: "cubic-bezier(0.5, 0, 0.5, 1)",
  },
  {
    translate: "0 0.05em",
    offset: 0.78,
    easing: "cubic-bezier(0.4, 0, 0.6, 1)",
  },
  { translate: "0 0" },
];
const LETTER_WAVE_MS = 680;
const LETTER_STAGGER_MS = 55;

/**
 * A hero link word whose letters bob up one after another, like a wave, each
 * time the pointer arrives on it (or it gains keyboard focus). The letters
 * are animated in place: replacing them under a resting pointer would fire a
 * fresh pointer-enter and restart the wave every frame.
 */
function WavingLink({
  word,
  color,
  onClick,
}: {
  word: string;
  color: string;
  onClick: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const waving = useRef(false);
  const wave = () => {
    const letters = button.current?.querySelectorAll("span");
    if (!letters || waving.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    waving.current = true;
    const runs = [...letters].map((letter, index) =>
      letter.animate(LETTER_WAVE, {
        duration: LETTER_WAVE_MS,
        delay: index * LETTER_STAGGER_MS,
      }),
    );
    void Promise.allSettled(runs.map((run) => run.finished)).then(() => {
      waving.current = false;
    });
  };
  return (
    <button
      ref={button}
      type="button"
      onClick={onClick}
      onPointerEnter={wave}
      onFocus={wave}
      aria-label={word}
      style={{ color }}
      className="hero-link focus-visible:ring-ring cursor-pointer rounded-md outline-none focus-visible:ring-2"
    >
      {[...word].map((letter, index) => (
        <span key={index} aria-hidden="true" className="inline-block">
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
 * The made-up emotional state of the clip playing at this stop, eased from
 * the previous one so the bars and radar glide between feelings.
 */
function useEmotionalState({ stop, index, state }: StopProps) {
  const clip =
    state.playing?.stop === index ? stop.clips[state.playing.clip] : null;
  const target = clip?.emotion;
  const [values, setValues] = useState(NEUTRAL_STATE);
  const shown = useRef(values);
  useEffect(() => {
    if (stop.panel !== "mascots") return;
    const from = shown.current;
    const to = { ...NEUTRAL_STATE, ...target };
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
  }, [stop.panel, target]);
  return values;
}

/** Mascot or text chips for a stop's clips; the playing one is marked. */
function ClipChips({ stop, index, state, controller }: StopProps) {
  const playing = state.playing?.stop === index ? state.playing.clip : null;
  return (
    <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:mt-6 md:flex-wrap md:overflow-visible md:px-0">
      {stop.clips.map((clip, clipIndex) => (
        <button
          key={clip.spec}
          type="button"
          aria-pressed={playing === clipIndex}
          onClick={() => controller.playClip(index, clipIndex)}
          className={cn(
            "bg-card/85 focus-visible:ring-ring inline-flex shrink-0 items-center gap-2 rounded-full border text-sm font-medium shadow-xs backdrop-blur transition outline-none focus-visible:ring-2",
            clip.mascot ? "py-1 pr-3.5 pl-1" : "px-3.5 py-1.5",
            playing === clipIndex
              ? "border-primary bg-primary/25 ring-primary/40 ring-2"
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
          {clip.label}
        </button>
      ))}
    </div>
  );
}

type MemoryFileId = "profile" | "identity" | "memories";

/** One of the Markdown notes memory is built from, as the demo shows it. */
type MemoryFile = {
  id: MemoryFileId;
  file: string;
  about: string;
  sections: { heading: string; lines: string[]; fresh?: string }[];
};

/**
 * The three built-in notes: the owner's profile (shared by every Anima), the
 * Anima's identity, and the relationship she writes herself while chatting.
 * Identity lines are from Annie's starter definition.
 */
const MEMORY_FILES: MemoryFile[] = [
  {
    id: "profile",
    file: "PROFILE.md",
    about: "Who you are, shared with every Anima.",
    sections: [
      { heading: "Basics", lines: ["Sam. Toronto, Eastern time."] },
      {
        heading: "People",
        lines: ["My sister Ana, who is getting married in June."],
      },
      {
        heading: "How I like to be treated",
        lines: ["Short replies. Gentle teasing is welcome."],
      },
    ],
  },
  {
    id: "identity",
    file: "IDENTITY.md",
    about: `Who ${STAGE_ANIMA_NAME} is: personality, voice and boundaries.`,
    sections: [
      {
        heading: "Essence",
        lines: [
          "A warm, curious companion who helps you think out loud and turn vague ideas into clear next steps.",
        ],
      },
      {
        heading: "Speaking style",
        lines: ["Relaxed and clear, with short sentences that sound natural."],
      },
      {
        heading: "Interests",
        lines: ["Journaling, cozy cafés and whatever you're excited about."],
      },
    ],
  },
  {
    id: "memories",
    file: "MEMORIES.md",
    about: `Your story together, kept by ${STAGE_ANIMA_NAME} as you chat.`,
    sections: [
      {
        heading: "Our story",
        lines: ["We met in exam season, both running on tea."],
        fresh: "Miso the kitten joined the family.",
      },
      {
        heading: "Open threads",
        lines: ["Piano recital on Friday. Ask how it went."],
      },
    ],
  },
];
const MEMORY_FILE_MS = 5500;

/**
 * The memory feature as it works in the app: a chat line, the reply's
 * "Memory updated" cue, then the notes memory is built from, one tab each.
 * The tabs cycle until the visitor picks one.
 */
function MemoryStory({ active }: { active: boolean }) {
  const step = useSteps(active, [300, 1300, 2500]);
  const [tab, setTab] = useState<MemoryFileId>("profile");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setTab("profile");
    setTouched(false);
  }, [active]);

  // Her new memory lands a beat after MEMORIES.md opens.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    setFresh(false);
    if (!active || tab !== "memories") return;
    const timer = window.setTimeout(() => setFresh(true), 700);
    return () => window.clearTimeout(timer);
  }, [active, tab]);

  useEffect(() => {
    if (!active || touched) return;
    const timer = window.setTimeout(() => {
      const index = MEMORY_FILES.findIndex(({ id }) => id === tab);
      setTab(MEMORY_FILES[(index + 1) % MEMORY_FILES.length].id);
    }, MEMORY_FILE_MS);
    return () => window.clearTimeout(timer);
  }, [active, touched, tab]);

  return (
    <div className="mt-5 space-y-3 text-left">
      <div className="bg-card/95 text-card-foreground hidden rounded-2xl border p-3.5 shadow-xl backdrop-blur md:block">
        <Reveal shown={step >= 1} className="flex justify-end">
          <p className="bg-secondary/70 max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm">
            We adopted a kitten today! Her name is Miso.
          </p>
        </Reveal>
        <Reveal shown={step >= 2} className="mt-2.5 flex items-end gap-2">
          <img
            src="/__stage/portrait"
            alt={STAGE_ANIMA_NAME}
            className="bg-muted size-7 shrink-0 rounded-full object-cover"
          />
          <div className="max-w-[85%]">
            <p className="bg-muted/70 rounded-2xl rounded-bl-md px-3.5 py-2 text-sm">
              Miso! Welcome to the family, little one. Tell me everything about
              her first week.
            </p>
            <Reveal
              shown={step >= 3}
              className="text-muted-foreground mt-1 ml-1 inline-flex items-center gap-1.5 text-xs"
            >
              <Brain aria-hidden="true" className="size-3.5" />
              Memory updated
            </Reveal>
          </div>
        </Reveal>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTouched(true);
          setTab(value as MemoryFileId);
        }}
        className="bg-card/95 text-card-foreground relative gap-0 overflow-hidden rounded-2xl border p-3 shadow-xl backdrop-blur"
      >
        <TabsList className="grid w-full grid-cols-3">
          {MEMORY_FILES.map((file) => (
            <TabsTrigger key={file.id} value={file.id} className="text-xs">
              {file.file}
            </TabsTrigger>
          ))}
        </TabsList>
        {MEMORY_FILES.map((file) => (
          <TabsContent
            key={file.id}
            value={file.id}
            className="px-1 pt-2.5 md:min-h-[13.5rem]"
          >
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <FileText aria-hidden="true" className="size-3.5 shrink-0" />
              {file.about}
              {file.id === "memories" ? (
                <span className="ml-auto shrink-0 rounded-md border px-1.5 py-0.5">
                  Version {fresh ? 13 : 12}
                </span>
              ) : null}
            </p>
            <div className="mt-2 space-y-1.5 text-sm">
              {file.sections.map((section, index) => (
                <div
                  key={section.heading}
                  className={cn(index > 1 && "max-md:hidden")}
                >
                  <p className="font-semibold">{section.heading}</p>
                  {section.lines.map((line) => (
                    <p key={line} className="text-muted-foreground">
                      {line}
                    </p>
                  ))}
                  {section.fresh ? (
                    <Reveal shown={fresh}>
                      <p className="border-success bg-success/10 text-foreground -mx-1.5 mt-1 rounded-r-md border-l-2 px-1.5 py-0.5">
                        {section.fresh}
                      </p>
                    </Reveal>
                  ) : null}
                </div>
              ))}
            </div>
          </TabsContent>
        ))}
        {active && !touched ? (
          <span
            key={tab}
            aria-hidden="true"
            className="bg-primary absolute inset-x-0 bottom-0 h-0.5 origin-left"
            style={{
              animation: `landing-progress ${MEMORY_FILE_MS}ms linear forwards`,
            }}
          />
        ) : null}
      </Tabs>
    </div>
  );
}

/** Step through `delays` (ms from activation) while `active`; 0 when not. */
function useSteps(active: boolean, delays: number[]) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    if (!active) return;
    const timers = delays.map((delay, index) =>
      window.setTimeout(() => setStep(index + 1), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // The delays are fixed for each caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return step;
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
        "transition-[opacity,translate] duration-500",
        shown ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

const EMPTY_CREATOR: CreatorState = {
  layers: {
    gradient: false,
    pattern: false,
    rays: false,
    stars: false,
    confetti: false,
  },
  palette: "sunny",
  particle: null,
};

/** The scripted build-up the creator plays until the visitor takes over. */
const CREATOR_SCRIPT: ((state: CreatorState) => CreatorState)[] = [
  () => EMPTY_CREATOR,
  (s) => ({ ...s, layers: { ...s.layers, gradient: true } }),
  (s) => ({ ...s, layers: { ...s.layers, pattern: true } }),
  (s) => ({ ...s, layers: { ...s.layers, rays: true } }),
  (s) => ({ ...s, layers: { ...s.layers, stars: true } }),
  (s) => ({ ...s, particle: "hearts" }),
  (s) => ({ ...s, palette: "blush", layers: { ...s.layers, confetti: true } }),
  (s) => ({ ...s, palette: "sky", particle: "sparkles" }),
  (s) => ({ ...s, palette: "lavender", particle: "butterflies" }),
];
const CREATOR_STEP_MS = 1700;

type CreatorDemo = {
  state: CreatorState;
  edit: (next: (current: CreatorState) => CreatorState) => void;
};

/**
 * A pocket version of the Scene and Particle Effect creators: background
 * layer switches, gradient palettes and particle presets, applied live. It
 * builds itself up on a script until the visitor changes something.
 */
function useCreator(active: boolean, controller: StageController): CreatorDemo {
  const [state, setState] = useState<CreatorState>(EMPTY_CREATOR);
  const [touched, setTouched] = useState(false);
  const step = useRef(0);

  useEffect(() => {
    if (!active || touched) return;
    step.current = 0;
    setState(EMPTY_CREATOR);
    const timer = window.setInterval(() => {
      step.current = (step.current + 1) % CREATOR_SCRIPT.length;
      setState((current) => CREATOR_SCRIPT[step.current](current));
    }, CREATOR_STEP_MS);
    return () => window.clearInterval(timer);
  }, [active, touched]);

  useEffect(() => {
    if (active) controller.setCreator(state);
  }, [active, controller, state]);

  return {
    state,
    edit: (next) => {
      setTouched(true);
      setState(next);
    },
  };
}

function SceneCard({ state, edit }: CreatorDemo) {
  return (
    <div className="bg-card/95 text-card-foreground mt-5 hidden rounded-2xl border p-3.5 shadow-xl backdrop-blur md:block">
      <p className="text-sm font-semibold">Scene layers</p>
      <ul className="mt-2.5 space-y-1.5">
        {CREATOR_LAYERS.map((layer) => (
          <li
            key={layer.id}
            className={cn(
              "flex items-center justify-between rounded-xl border px-3 py-1.5 text-sm transition-colors",
              state.layers[layer.id] && "border-primary/60 bg-primary/10",
            )}
          >
            <label htmlFor={`layer-${layer.id}`}>{layer.label}</label>
            <Switch
              id={`layer-${layer.id}`}
              checked={state.layers[layer.id]}
              onCheckedChange={(checked) =>
                edit((current) => ({
                  ...current,
                  layers: { ...current.layers, [layer.id]: checked },
                }))
              }
            />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs font-medium">
        Gradient colours
      </p>
      <div className="mt-1.5 flex gap-2">
        {CREATOR_PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            aria-label={palette.label}
            aria-pressed={state.palette === palette.id}
            onClick={() =>
              edit((current) => ({
                ...current,
                palette: palette.id,
                layers: { ...current.layers, gradient: true },
              }))
            }
            className={cn(
              "focus-visible:ring-ring size-7 rounded-full border-2 border-white shadow-sm transition outline-none focus-visible:ring-2",
              state.palette === palette.id && "ring-primary ring-2",
            )}
            style={{
              background: `linear-gradient(135deg, ${palette.stops[0]}, ${palette.stops[1]})`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ParticleCard({
  state,
  edit,
  className,
}: CreatorDemo & { className?: string }) {
  return (
    <div
      className={cn(
        "bg-card/95 text-card-foreground rounded-2xl border p-3 shadow-xl backdrop-blur",
        className,
      )}
    >
      <p className="hidden text-sm font-semibold md:block">Particles</p>
      {/* Phone-only classes use max-md: so the Scene layers' later `.flex`
          cannot override the desktop grid. */}
      <div className="max-md:flex max-md:gap-2 max-md:overflow-x-auto md:mt-2.5 md:grid md:grid-cols-2 md:gap-2">
        {CREATOR_PARTICLES.map((particle) => {
          const Icon = PARTICLE_ICONS[particle.id];
          const selected = state.particle === particle.id;
          return (
            <button
              key={particle.id}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                edit((current) => ({
                  ...current,
                  particle: selected ? null : particle.id,
                }))
              }
              className={cn(
                "focus-visible:ring-ring flex shrink-0 flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-medium transition outline-none focus-visible:ring-2",
                selected ? "border-primary bg-primary/20" : "hover:bg-muted/60",
              )}
            >
              <Icon aria-hidden="true" className="size-5" />
              {particle.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DownloadActions() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2.5">
      <Button asChild className="rounded-full">
        <a href={DOCS_URL}>
          <BookOpen aria-hidden="true" />
          Read the docs
        </a>
      </Button>
      {[
        { label: "macOS", Icon: Apple },
        { label: "Windows", Icon: Monitor },
      ].map(({ label, Icon }) => (
        <span
          key={label}
          className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm"
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </span>
      ))}
    </div>
  );
}
