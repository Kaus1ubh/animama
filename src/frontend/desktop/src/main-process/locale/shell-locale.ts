import type { BrowserWindow } from "electron";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import {
  isUiLocale,
  localeDirection,
  resolveLocale,
  type UiLocale,
} from "@animama/runtime-contracts/locale";

import en from "../../locales/en.json" with { type: "json" };
import ja from "../../locales/ja.json" with { type: "json" };
import ko from "../../locales/ko.json" with { type: "json" };
import zhHans from "../../locales/zh-Hans.json" with { type: "json" };
import zhHant from "../../locales/zh-Hant.json" with { type: "json" };
import { writeLog } from "../logging.js";
import { atomicWrite } from "../runtime/atomic-file.js";

/**
 * The desktop shell's own text (startup/recovery page, window titles and the
 * application menu) in the UI Locale the app last applied on this machine.
 * The shell works while the backend is unavailable, so it keeps its own small
 * catalogs (`desktop/src/locales/<tag>.json`) and a cache of that locale
 * instead of reading App settings.
 */

const CATALOGS: Readonly<Record<UiLocale, unknown>> = {
  en,
  ja,
  ko,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

/** Dotted paths to the string leaves of a catalog. */
type Leaves<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends string
    ? `${Prefix}${Key}`
    : Leaves<T[Key], `${Prefix}${Key}.`>;
}[keyof T & string];

/** A key of the English shell catalog, which every other catalog falls back to. */
export type ShellKey = Leaves<typeof en>;

/** Interpolation values for `{{name}}` placeholders. */
export type ShellParams = Readonly<Record<string, string>>;

/** The string table for one locale, with the `lang` and `dir` its documents declare. */
export type ShellStrings = {
  readonly locale: UiLocale;
  readonly dir: "ltr" | "rtl";
  text(key: ShellKey, params?: ShellParams): string;
};

function lookup(catalog: unknown, key: string): string | undefined {
  let node = catalog;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part))
      return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  // An empty translation counts as missing, as in the web catalogs.
  return typeof node === "string" && node !== "" ? node : undefined;
}

/** Replace `{{name}}` placeholders; an unknown name stays visible rather than vanishing. */
function interpolate(template: string, params: ShellParams = {}): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/gu, (placeholder, name) =>
    Object.hasOwn(params, name) ? params[name]! : placeholder,
  );
}

/** Strings for a locale; a key missing from a beta catalog shows its English text. */
export function shellStrings(locale: UiLocale): ShellStrings {
  return {
    locale,
    dir: localeDirection(locale),
    text: (key, params) =>
      interpolate(
        lookup(CATALOGS[locale], key) ?? lookup(en, key) ?? key,
        params,
      ),
  };
}

/** Version of the `{version, locale}` cache file; any other content is ignored. */
export const LOCALE_CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 1024;

/**
 * The cached locale, or `null` when the file is missing, oversized, not a
 * regular file or not a current-version cache of a supported tag. Invalid
 * content is only ignored here; the next applied locale replaces it.
 */
export function readCachedLocale(file: string): UiLocale | null {
  let descriptor: number | undefined;
  try {
    // Never follow a link planted in place of the cache.
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) return null;
    const cache: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
    if (
      !cache ||
      typeof cache !== "object" ||
      (cache as { version?: unknown }).version !== LOCALE_CACHE_VERSION
    )
      return null;
    const { locale } = cache as { locale?: unknown };
    return isUiLocale(locale) ? locale : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Save the applied locale atomically in the private profile directory. */
export function writeCachedLocale(file: string, locale: UiLocale): void {
  atomicWrite(
    file,
    `${JSON.stringify({ version: LOCALE_CACHE_VERSION, locale })}\n`,
  );
}

/**
 * The shell's current locale: the last locale the app applied (cached in
 * `file`), else the first supported OS language, else English. The app reports
 * each locale it applies through {@link ShellLocale.apply}; the development
 * pseudo-locale is never reported, so it never reaches the cache.
 */
export class ShellLocale {
  private cached: UiLocale | null = null;
  private current: ShellStrings | undefined;
  private listeners = new Set<(strings: ShellStrings) => void>();

  constructor(
    private readonly file: string,
    private readonly systemLanguages: () => readonly string[],
  ) {}

  /** Resolved on first use, which follows app readiness. */
  get strings(): ShellStrings {
    if (!this.current) {
      this.cached = readCachedLocale(this.file);
      this.current = shellStrings(
        resolveLocale({
          saved: this.cached,
          preferred: this.systemLanguages(),
        }),
      );
    }
    return this.current;
  }

  /**
   * Record the locale the app applied and switch the shell to it. A cache
   * write failure is logged and retried on the next report; it only costs the
   * next launch's startup page its language.
   */
  apply(locale: UiLocale): void {
    const previous = this.strings.locale;
    if (this.cached !== locale) {
      try {
        writeCachedLocale(this.file, locale);
        this.cached = locale;
      } catch {
        writeLog("error", "Locale cache write failed");
      }
    }
    if (locale === previous) return;
    this.current = shellStrings(locale);
    for (const listener of this.listeners) listener(this.current);
  }

  /** Call `listener` after each locale change; returns its removal. */
  onChange(listener: (strings: ShellStrings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Title a window from the shell catalog and keep it in the current locale. The
 * web document's generic `<title>` would otherwise replace the descriptive
 * title the OS shows in window lists and to assistive technology.
 */
export function keepLocalizedTitle(
  window: Pick<BrowserWindow, "setTitle" | "isDestroyed" | "on" | "once">,
  locale: Pick<ShellLocale, "strings" | "onChange">,
  key: ShellKey,
): void {
  window.setTitle(locale.strings.text(key));
  window.on("page-title-updated", (event) => event.preventDefault());
  const stop = locale.onChange((strings) => {
    if (!window.isDestroyed()) window.setTitle(strings.text(key));
  });
  window.once("closed", stop);
}
