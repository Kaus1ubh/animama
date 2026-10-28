import { useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Menu, Moon, Sun } from "lucide-react";

import {
  SUPPORTED_LOCALES,
  localeNativeName,
  type UiLocale,
} from "@animama/runtime-contracts/locale";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/components/dropdown-menu";

import { LocaleFlag } from "./flags";
import { BETA_ACCESS_URL, CLOSED_BETA, SITE } from "./stops";

/*
 * The header every animama.ai page shares. The landing page's overlay renders
 * it over the tour; the production build also prerenders it for the pages
 * Animama Cloud publishes beside the landing page (About, Download, Privacy,
 * Terms), where `site-chrome.tsx` brings it to life. One component keeps the
 * pages' headers identical.
 */

/** The site pages a header can mark as current (`aria-current`). */
export type SitePage = "about" | "download";

/**
 * The landing page's tour, when the header sits over it: Home and Download
 * scroll the tour, and the Avatar choice shows (the switcher beside the pill,
 * and the options in the phone menu).
 */
type SiteHeaderTour = {
  scrollToStop: (index: number) => void;
  lastStop: number;
  avatarSwitcher: ReactNode;
  avatarOptions: ReactNode;
};

/**
 * The header's one solid button: product-ui's default `Button` classes, kept
 * here because importing `Button` brings product-ui's whole components bundle
 * (Markdown rendering among it) into the header Cloud's pages load.
 */
const solidButton =
  "bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-all outline-none has-[>svg]:px-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/**
 * Keyboard focus ring for chrome over the stop's backdrop: white over the
 * twilight stop's light ink, where the theme ring falls below 3:1.
 */
export const focusRing = (light: boolean) =>
  light ? "focus-visible:ring-white" : "focus-visible:ring-ring";

/**
 * The site header: the logo on the left; on the right one liquid-glass pill
 * holding Home, About and Docs, the theme toggle and language picker, Log in
 * and Sign up (placeholders until accounts exist), and Download as its one
 * solid button. During the closed beta the page is English only, Request Beta
 * Access (the form) replaces the language picker, Log in, Sign up and that
 * button, and Download becomes a link beside About (the download page). A
 * single soft highlight glides to whichever item the pointer is over. Below 1024px the pill gives way to that button and a menu button that
 * holds the same items (`SiteMenu`).
 *
 * Over the tour (`tour`) the header is fixed above the stage, Home and
 * Download scroll it, and the Avatar switcher sits to the left of the pill or
 * menu. On the other pages it sits at the top of the page, and Home and
 * Download are links.
 */
export function SiteHeader({
  light = false,
  tour,
  current,
}: {
  light?: boolean;
  tour?: SiteHeaderTour;
  current?: SitePage;
}) {
  const pill = useRef<HTMLElement>(null);
  const [glow, setGlow] = useState<{ x: number; w: number } | null>(null);
  const theme = useThemeMode();
  const [locale, setLocale] = useState<UiLocale>("en");
  /** Move the highlight to the item under the pointer (or keyboard focus). */
  const track = (event: { target: EventTarget }) => {
    const item = (event.target as HTMLElement).closest("[data-pill-item]");
    const box = pill.current?.getBoundingClientRect();
    if (!item || !box) return;
    const rect = item.getBoundingClientRect();
    setGlow({ x: rect.left - box.left, w: rect.width });
  };
  const link = cn(
    "relative z-10 cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2",
    focusRing(light),
    light
      ? "text-white"
      : "text-foreground/75 hover:text-foreground dark:text-foreground/80 dark:hover:text-foreground aria-[current=page]:text-foreground",
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
  const primary = (className: string) => {
    const solid = cn(
      solidButton,
      "group relative z-10 cursor-pointer rounded-full",
      className,
    );
    const download = (
      <>
        Download
        <ArrowRight
          aria-hidden="true"
          className="transition-transform group-hover:translate-x-0.5"
        />
      </>
    );
    if (CLOSED_BETA)
      return (
        <a
          href={BETA_ACCESS_URL}
          target="_blank"
          rel="noreferrer"
          data-pill-item=""
          className={solid}
        >
          {/* Shorter on phones, so the logo keeps its room. */}
          <span className="max-sm:hidden">Request Beta Access</span>
          <span className="sm:hidden">Request access</span>
          <ArrowUpRight
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </a>
      );
    return tour ? (
      <button
        type="button"
        data-pill-item=""
        className={solid}
        onClick={() => tour.scrollToStop(tour.lastStop)}
      >
        {download}
      </button>
    ) : (
      <a href={SITE.download} data-pill-item="" className={solid}>
        {download}
      </a>
    );
  };
  return (
    <header
      className={cn(
        "inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 md:px-10 md:py-5",
        tour ? "fixed" : "relative",
      )}
    >
      <Wordmark light={light} home={!tour} />
      <div className="flex items-center gap-3">
        {tour?.avatarSwitcher}
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
          {tour ? (
            <button
              type="button"
              data-pill-item=""
              className={link}
              onClick={() => tour.scrollToStop(0)}
            >
              Home
            </button>
          ) : (
            <a href="/" data-pill-item="" className={link}>
              Home
            </a>
          )}
          <a
            href={SITE.about}
            data-pill-item=""
            aria-current={current === "about" ? "page" : undefined}
            className={link}
          >
            About
          </a>
          {CLOSED_BETA ? (
            <a
              href={SITE.download}
              data-pill-item=""
              aria-current={current === "download" ? "page" : undefined}
              className={link}
            >
              Download
            </a>
          ) : null}
          <a
            href={SITE.docsUrl}
            target="_blank"
            rel="noreferrer"
            data-pill-item=""
            className={link}
          >
            Docs
          </a>
          {divider}
          <ThemeToggle light={light} theme={theme} />
          {CLOSED_BETA ? null : (
            <LanguagePicker
              locale={locale}
              onLocaleChange={setLocale}
              light={light}
            />
          )}
          {CLOSED_BETA ? null : (
            <>
              {divider}
              <button type="button" data-pill-item="" className={link}>
                Log in
              </button>
              <button type="button" data-pill-item="" className={link}>
                Sign up
              </button>
            </>
          )}
          {primary("ml-1 hover:brightness-105")}
        </nav>
        {/* Narrow-only, as `hidden max-lg:flex`: the Scene layers' later `.flex`
          would override `lg:hidden`. */}
        <div className="hidden items-center gap-2 max-lg:flex">
          {primary("max-sm:px-3 max-sm:[&>svg]:hidden")}
          <SiteMenu
            light={light}
            tour={tour}
            theme={theme}
            locale={locale}
            onLocaleChange={setLocale}
          />
        </div>
      </div>
    </header>
  );
}

const THEME_KEY = "landing-stage-theme";

type ThemeMode = { dark: boolean; toggle: () => void };

/**
 * Light and dark mode, using the app's own `.dark` theme. The choice is
 * remembered in this browser, for every page on the site (`theme.js` applies
 * it before first paint). Prerendering has no document and starts light.
 */
function useThemeMode(): ThemeMode {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
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
  return { dark, toggle };
}

function ThemeToggle({
  light,
  theme: { dark, toggle },
}: {
  light: boolean;
  theme: ThemeMode;
}) {
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      data-pill-item=""
      className={cn(
        "relative z-10 flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2",
        focusRing(light),
        light
          ? "text-white"
          : "text-foreground/75 hover:text-foreground dark:text-foreground/80 dark:hover:text-foreground",
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
type LocaleChoice = {
  locale: UiLocale;
  onLocaleChange: (locale: UiLocale) => void;
};

function LanguagePicker({
  locale,
  onLocaleChange,
  light,
}: LocaleChoice & { light: boolean }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        data-pill-item=""
        className={cn(
          "relative z-10 flex size-8 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2",
          focusRing(light),
        )}
        aria-label={`Language: ${localeNativeName(locale)}`}
      >
        <LocaleFlag locale={locale} className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50 min-w-44">
        <LanguageOptions locale={locale} onLocaleChange={onLocaleChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The app's UI Locales by flag and their own names, as menu radio items. */
function LanguageOptions({ locale, onLocaleChange }: LocaleChoice) {
  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(value) => onLocaleChange(value as UiLocale)}
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
  );
}

/**
 * The header's items for screens narrower than the pill (below 1024px): a
 * glass menu button opening Home, About, Download (during the closed beta),
 * Docs, the Avatar choice (phones only, over the tour), dark mode, and the
 * language list, Log in and Sign up (none of these three during the closed
 * beta). Toggling dark mode keeps the
 * menu open so the change shows behind it.
 */
function SiteMenu({
  light,
  tour,
  theme,
  locale,
  onLocaleChange,
}: LocaleChoice & {
  light: boolean;
  tour?: SiteHeaderTour;
  theme: ThemeMode;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="Menu"
        data-ink={light ? "light" : "dark"}
        className={cn(
          "liquid-glass flex size-9 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2",
          focusRing(light),
          light ? "text-white" : "text-foreground",
        )}
      >
        <Menu className="size-4.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-50 w-60 max-w-[calc(100vw-2.5rem)]"
      >
        {tour ? (
          <DropdownMenuItem onSelect={() => tour.scrollToStop(0)}>
            Home
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <a href="/">Home</a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href={SITE.about}>About</a>
        </DropdownMenuItem>
        {CLOSED_BETA ? (
          <DropdownMenuItem asChild>
            <a href={SITE.download}>Download</a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href={SITE.docsUrl} target="_blank" rel="noreferrer">
            Docs
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Phone-only, as `hidden max-sm:block` (see the header's note). */}
        {tour?.avatarOptions ? (
          <div className="hidden max-sm:block">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
              Avatar
            </DropdownMenuLabel>
            {tour.avatarOptions}
            <DropdownMenuSeparator />
          </div>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={theme.dark}
          onCheckedChange={theme.toggle}
          onSelect={(event) => event.preventDefault()}
        >
          Dark mode
        </DropdownMenuCheckboxItem>
        {CLOSED_BETA ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
              Language
            </DropdownMenuLabel>
            <LanguageOptions locale={locale} onLocaleChange={onLocaleChange} />
          </>
        )}
        {CLOSED_BETA ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Log in</DropdownMenuItem>
            <DropdownMenuItem>Sign up</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The app's logo: speech-bubble mark and rounded wordmark. The mark's `alt`
 * names the lockup; a bare `span` cannot take `aria-label`, and the wordmark
 * beside it is a decorative mask (`.wordmark-mask`, a class rather than an
 * inline style, which the site's CSP refuses in prerendered markup). Off the
 * landing page (`home`) it links back there.
 */
function Wordmark({ light, home }: { light: boolean; home: boolean }) {
  const lockup = (
    <>
      <img
        src="/brand/animama-mark.png"
        alt="Animama"
        className="size-9 md:size-12"
      />
      <span
        aria-hidden="true"
        className={cn(
          "wordmark-mask block h-8 w-[92px] transition-colors duration-500 md:h-11 md:w-[132px]",
          light ? "bg-white" : "bg-foreground",
        )}
      />
    </>
  );
  return home ? (
    <a
      href="/"
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full outline-none focus-visible:ring-2",
        focusRing(light),
      )}
    >
      {lockup}
    </a>
  ) : (
    <span className="flex shrink-0 items-center gap-2">{lockup}</span>
  );
}
