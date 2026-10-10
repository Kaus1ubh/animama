import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SOURCE_LOCALE,
  formattingLocale,
  isUiLocale,
} from "@animama/runtime-contracts/locale";

/** Locale-aware formatting helpers bound to one `Intl` locale tag. */
export interface LocaleFormatters {
  /** The `Intl` tag in use, for code that must call `Intl` directly. */
  readonly locale: string;
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  time(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  dateTime(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  relative(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  list(items: readonly string[], type?: Intl.ListFormatType): string;
  /** Binary-scaled size (1 kB = 1024 bytes) with localized units, at least 1 kB below 1 MB. */
  fileSize(bytes: number): string;
  /** Locale collation for user-visible sorting. */
  compare(left: string, right: string): number;
}

const MEGABYTE = 1024 ** 2;
const GIGABYTE = 1024 ** 3;

/** Build formatters for one `Intl` locale tag. */
export function createFormatters(locale: string): LocaleFormatters {
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  return {
    locale,
    date: (value, options = { dateStyle: "medium" }) =>
      new Intl.DateTimeFormat(locale, options).format(value),
    time: (value, options = { timeStyle: "short" }) =>
      new Intl.DateTimeFormat(locale, options).format(value),
    dateTime: (value, options = { dateStyle: "medium", timeStyle: "short" }) =>
      new Intl.DateTimeFormat(locale, options).format(value),
    relative: (value, unit, options = { numeric: "auto" }) =>
      new Intl.RelativeTimeFormat(locale, options).format(value, unit),
    number: (value, options) =>
      new Intl.NumberFormat(locale, options).format(value),
    list: (items, type = "conjunction") =>
      new Intl.ListFormat(locale, { style: "long", type }).format(items),
    fileSize: (bytes) => {
      const format = (unit: string, amount: number, fractionDigits: number) =>
        new Intl.NumberFormat(locale, {
          style: "unit",
          unit,
          unitDisplay: "short",
          maximumFractionDigits: fractionDigits,
        }).format(amount);
      if (bytes >= GIGABYTE) return format("gigabyte", bytes / GIGABYTE, 1);
      if (bytes >= MEGABYTE) return format("megabyte", bytes / MEGABYTE, 1);
      return format("kilobyte", Math.max(1, Math.round(bytes / 1024)), 0);
    },
    compare: (left, right) => collator.compare(left, right),
  };
}

/** The browser or OS preferred-language list, most preferred first. */
export function systemPreferredLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const languages = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return languages.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/** Formatters for a UI Locale tag (English for anything else), outside React. */
export function formattersForLanguage(
  language: string | undefined,
): LocaleFormatters {
  const locale = language && isUiLocale(language) ? language : SOURCE_LOCALE;
  return createFormatters(formattingLocale(locale, systemPreferredLanguages()));
}

/**
 * Formatters for the active UI Locale. The system region applies when its
 * language matches the active locale; the pseudo-locale formats as English.
 */
export function useFormatters(): LocaleFormatters {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return useMemo(() => formattersForLanguage(language), [language]);
}
