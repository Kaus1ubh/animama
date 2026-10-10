import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { systemPreferredLanguages } from "@animama/product-ui/i18n";
import {
  SUPPORTED_LOCALES,
  isBetaLocale,
  isUiLocale,
  localeNativeName,
  resolveLocale,
} from "@animama/runtime-contracts/locale";

import { cn } from "@/lib/utils";
import {
  normalizeHexColor,
  parseAppearanceOverrides,
  APPEARANCE_COLOR_TOKENS,
  type AppearanceColorToken,
  type AppearanceMode,
} from "@/lib/theme/appearance-overrides";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { useUserSettings } from "@/query/hooks/useUserSettings";
import { useUpdateUserSettings } from "@/query/mutations/useUpdateUserSettings";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { THEME_MODES } from "@/ui/theme/theme-provider";

/** Select value standing for "follow the OS or browser language". */
const SYSTEM_LOCALE = "system";

function isChartColorKey(
  key: AppearanceColorToken["key"],
): key is `chart_${number}` {
  return key.startsWith("chart_");
}

/** Display label for a colour token; chart tokens share one numbered label. */
export function colorTokenLabel(
  t: TFunction<"settings">,
  token: AppearanceColorToken,
): string {
  const key = token.key;
  if (isChartColorKey(key))
    return t("appearance.colors.tokens.chart", {
      index: Number(key.slice("chart_".length)),
    });
  switch (key) {
    case "primary":
      return t("appearance.colors.tokens.primary");
    case "secondary":
      return t("appearance.colors.tokens.secondary");
    case "accent":
      return t("appearance.colors.tokens.accent");
    case "background":
      return t("appearance.colors.tokens.background");
    case "foreground":
      return t("appearance.colors.tokens.foreground");
    case "card":
      return t("appearance.colors.tokens.card");
    case "popover":
      return t("appearance.colors.tokens.popover");
    case "muted":
      return t("appearance.colors.tokens.muted");
    case "muted_foreground":
      return t("appearance.colors.tokens.muted_foreground");
    case "border":
      return t("appearance.colors.tokens.border");
    case "input":
      return t("appearance.colors.tokens.input");
    case "ring":
      return t("appearance.colors.tokens.ring");
    case "destructive":
      return t("appearance.colors.tokens.destructive");
    case "sidebar":
      return t("appearance.colors.tokens.sidebar");
    case "sidebar_foreground":
      return t("appearance.colors.tokens.sidebar_foreground");
    case "sidebar_primary":
      return t("appearance.colors.tokens.sidebar_primary");
    case "sidebar_accent":
      return t("appearance.colors.tokens.sidebar_accent");
    case "sidebar_border":
      return t("appearance.colors.tokens.sidebar_border");
    default: {
      // Every named colour needs its own catalog key.
      const unlabelled: never = key;
      return unlabelled;
    }
  }
}

/** Display name for a colour group. */
export function colorGroupLabel(
  t: TFunction<"settings">,
  group: AppearanceColorToken["group"],
): string {
  switch (group) {
    case "basic":
      return t("appearance.colors.groups.basic");
    case "surfaces":
      return t("appearance.colors.groups.surfaces");
    case "lines":
      return t("appearance.colors.groups.lines");
    case "status":
      return t("appearance.colors.groups.status");
    case "sidebar":
      return t("appearance.colors.groups.sidebar");
    case "charts":
      return t("appearance.colors.groups.charts");
  }
}

/**
 * Interface language picker. "System default" stores no preference so the app
 * follows the OS or browser; every language is named in its own script, so a
 * user who cannot read the active language can still find theirs.
 */
export function LanguageSetting() {
  const { t } = useTranslation(["settings", "common"]);
  const { data: settings } = useUserSettings();
  const { mutateAsync: updateUserSettings, isPending } =
    useUpdateUserSettings();
  const saved = isUiLocale(settings?.locale) ? settings.locale : null;
  const systemLocale = resolveLocale({ preferred: systemPreferredLanguages() });
  const nameWithBeta = (locale: (typeof SUPPORTED_LOCALES)[number]) =>
    isBetaLocale(locale)
      ? `${localeNativeName(locale)} · ${t("common:beta")}`
      : localeNativeName(locale);

  return (
    <SettingsRow
      label={t("appearance.language.label")}
      description={t("appearance.language.description")}
      control={
        <Select
          value={saved ?? SYSTEM_LOCALE}
          disabled={!settings || isPending}
          onValueChange={(value) => {
            const locale = isUiLocale(value) ? value : null;
            void updateUserSettings({ body: { locale } }).catch(() =>
              toast.error(t("appearance.language.saveFailed")),
            );
          }}
        >
          <SelectTrigger
            className="w-56"
            aria-label={t("appearance.language.label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SYSTEM_LOCALE}>
              {t("appearance.language.systemDefaultResolved", {
                language: localeNativeName(systemLocale),
              })}
            </SelectItem>
            {SUPPORTED_LOCALES.map((locale) => (
              <SelectItem key={locale} value={locale} lang={locale}>
                {nameWithBeta(locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/** Delay before a colour chosen with the native picker is saved. */
const PICKER_SAVE_DELAY_MS = 400;

/** The mode currently in effect, so overrides edit what the owner sees. */
function useResolvedMode(): AppearanceMode {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? "dark" : "light";
}

/** Static miniature of the app chrome used by the mode tiles. */
function ModePreview({ variant }: { variant: "light" | "dark" }) {
  const dark = variant === "dark";
  return (
    <div
      className={cn(
        "flex h-full w-full gap-1 p-1.5",
        dark ? "bg-neutral-900" : "bg-neutral-100",
      )}
    >
      <div
        className={cn("w-3 rounded-sm", dark ? "bg-neutral-700" : "bg-white")}
      />
      <div
        className={cn(
          "flex flex-1 flex-col gap-1 rounded-sm p-1.5",
          dark ? "bg-neutral-800" : "bg-white",
        )}
      >
        <div className="bg-primary h-1 w-3/4 rounded-full" />
        <div
          className={cn(
            "h-1 w-1/2 rounded-full",
            dark ? "bg-neutral-600" : "bg-neutral-300",
          )}
        />
        <div
          className={cn(
            "mt-auto h-2 rounded-full border",
            dark ? "border-neutral-600" : "border-neutral-300",
          )}
        />
      </div>
    </div>
  );
}

/** Mode picker: System / Light / Dark preview tiles in a radio group. */
export function AppearanceModeSetting() {
  const { t } = useTranslation("settings");
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored theme after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "light") : null;

  return (
    <SettingsRow
      label={t("appearance.theme.label")}
      control={
        <div
          role="radiogroup"
          aria-label={t("appearance.theme.modeLabel")}
          className="flex flex-wrap gap-3"
        >
          {THEME_MODES.map((mode) => {
            const selected = current === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(mode)}
                className="group flex flex-col items-center gap-1.5 text-xs"
              >
                <span
                  className={cn(
                    "border-border flex h-16 w-24 overflow-hidden rounded-lg border-2 transition",
                    "group-focus-visible:ring-ring group-focus-visible:ring-2",
                    selected
                      ? "border-primary"
                      : "group-hover:border-foreground/30",
                  )}
                >
                  {mode === "system" ? (
                    <>
                      <span className="w-1/2 overflow-hidden">
                        <ModePreview variant="light" />
                      </span>
                      <span className="w-1/2 overflow-hidden">
                        <ModePreview variant="dark" />
                      </span>
                    </>
                  ) : (
                    <ModePreview variant={mode} />
                  )}
                </span>
                <span
                  className={cn(
                    selected
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {t(`appearance.theme.modes.${mode}`)}
                </span>
              </button>
            );
          })}
        </div>
      }
    />
  );
}

/** Convert any computed CSS colour to `#rrggbb` for the native colour input. */
function cssColorToHex(value: string): string | null {
  if (typeof document === "undefined" || !value) return null;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.fillStyle = value;
  return normalizeHexColor(context.fillStyle);
}

/** Current built-in colour for a token in the resolved mode. */
function useDefaultColor(
  cssVar: string,
  mode: AppearanceMode,
  override: string | null,
) {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    // The provider replaces the override stylesheet in a parent effect, which
    // runs after this one; read on the next frame so removals are reflected.
    const frame = requestAnimationFrame(() => {
      const probe = document.createElement("div");
      probe.className = mode === "dark" ? "dark" : "";
      probe.style.cssText = `position:absolute;visibility:hidden;color:var(--${cssVar})`;
      document.body.appendChild(probe);
      setColor(cssColorToHex(getComputedStyle(probe).color));
      probe.remove();
    });
    return () => cancelAnimationFrame(frame);
  }, [cssVar, mode, override]);
  return color;
}

/**
 * One colour override row: swatch/native picker, hex text input and reset.
 * Invalid hex input is rejected and the saved value is kept.
 */
export function AppearanceColorSetting({
  token,
}: {
  token: AppearanceColorToken;
}) {
  const colorKey = token.key;
  const { userPreferences, updateUserPreferences } = useSettings();
  const mode = useResolvedMode();
  const saved =
    parseAppearanceOverrides(userPreferences?.appearance)[mode]?.[colorKey] ??
    null;
  const defaultColor = useDefaultColor(token.cssVar, mode, saved);
  const pickerTimer = useRef<number | null>(null);
  const pendingPickerColor = useRef<string | null>(null);
  const [draft, setDraft] = useState(saved ?? "");
  const [invalid, setInvalid] = useState(false);
  const { t } = useTranslation("settings");
  const label = colorTokenLabel(t, token);

  useEffect(() => {
    setDraft(saved ?? "");
    setInvalid(false);
  }, [saved]);

  const save = (next: string | undefined) => {
    if ((next ?? null) === saved) return;
    void updateUserPreferences({
      appearance: { [mode]: { [colorKey]: next } },
    }).catch(() => {
      setDraft(saved ?? "");
      toast.error(t("appearance.colors.updateFailed", { label }));
    });
  };
  // The debounced picker save must use the latest preferences and mode.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  const flushPickerSave = () => {
    if (pickerTimer.current !== null) window.clearTimeout(pickerTimer.current);
    pickerTimer.current = null;
    const color = pendingPickerColor.current;
    pendingPickerColor.current = null;
    if (color) saveRef.current(color);
  };
  // Closing the modal mid-drag still saves the colour last shown.
  const flushPickerSaveRef = useRef(flushPickerSave);
  useEffect(() => () => flushPickerSaveRef.current(), []);

  const commitDraft = () => {
    if (!draft.trim()) {
      setInvalid(false);
      save(undefined);
      return;
    }
    const color = normalizeHexColor(draft);
    if (!color) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(color);
    save(color);
  };

  const swatch = saved ?? defaultColor ?? "#000000";

  return (
    <SettingsRow
      label={label}
      description={
        invalid ? (
          <span className="text-destructive" role="alert">
            {t("appearance.colors.invalidHex")}
          </span>
        ) : saved ? (
          t(`appearance.colors.customForMode.${mode}`)
        ) : null
      }
      control={
        <div className="flex items-center gap-2">
          {saved ? (
            <button
              type="button"
              onClick={() => save(undefined)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:outline-none"
              aria-label={t("appearance.colors.reset", { label })}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          ) : null}
          <div className="border-input focus-within:ring-ring/50 focus-within:border-ring flex h-9 items-center gap-2 rounded-full border pr-3 pl-1.5 focus-within:ring-[3px]">
            <label
              className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border"
              style={{ backgroundColor: swatch }}
            >
              <span className="sr-only">
                {t("appearance.colors.pick", { label })}
              </span>
              <input
                type="color"
                value={swatch}
                onChange={(event) => {
                  const color = normalizeHexColor(event.target.value);
                  if (!color) return;
                  setDraft(color);
                  setInvalid(false);
                  // The native picker emits continuously while dragging; save
                  // once the value settles instead of on every movement.
                  pendingPickerColor.current = color;
                  if (pickerTimer.current !== null)
                    window.clearTimeout(pickerTimer.current);
                  pickerTimer.current = window.setTimeout(
                    flushPickerSave,
                    PICKER_SAVE_DELAY_MS,
                  );
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <Input
              value={draft}
              placeholder={defaultColor ?? t("appearance.colors.hexDefault")}
              aria-label={t("appearance.colors.hexLabel", { label })}
              aria-invalid={invalid}
              spellCheck={false}
              maxLength={7}
              onChange={(event) => {
                setDraft(event.target.value);
                setInvalid(false);
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                }
              }}
              className="h-7 w-20 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
        </div>
      }
    />
  );
}

/** Shows or hides the Advanced colour groups (they stay searchable). */
export function AdvancedColorsToggleSetting({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <SettingsRow
      label={t("appearance.colors.advanced.label")}
      description={t("appearance.colors.advanced.description")}
      control={
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? t("common:actions.hide") : t("common:actions.show")}
        </Button>
      }
    />
  );
}

/** Clear every colour override for the mode in effect. */
export function ResetColorsSetting() {
  const { t } = useTranslation(["settings", "common"]);
  const { userPreferences, updateUserPreferences } = useSettings();
  const mode = useResolvedMode();
  const saved = parseAppearanceOverrides(userPreferences?.appearance)[mode];
  const count = saved ? Object.keys(saved).length : 0;
  return (
    <SettingsRow
      label={t("appearance.colors.resetAll.label")}
      description={
        count
          ? t(`appearance.colors.resetAll.description.${mode}`, { count })
          : t(`appearance.colors.resetAll.none.${mode}`)
      }
      control={
        <Button
          type="button"
          variant="outline"
          disabled={!count}
          onClick={() => {
            // Undefined values are dropped when preferences are serialized.
            const cleared = Object.fromEntries(
              APPEARANCE_COLOR_TOKENS.map((token) => [token.key, undefined]),
            );
            void updateUserPreferences({
              appearance: { [mode]: cleared },
            }).catch(() => toast.error(t("appearance.colors.resetAll.failed")));
          }}
        >
          {t("common:actions.resetAll")}
        </Button>
      }
    />
  );
}
