import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

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
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { THEME_MODES, type ThemeMode } from "@/ui/theme/theme-provider";

const MODE_LABELS: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

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
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored theme after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? (theme ?? "light") : null;

  return (
    <SettingsRow
      label="Theme"
      control={
        <div
          role="radiogroup"
          aria-label="Theme mode"
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
                  {MODE_LABELS[mode]}
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
  const label = token.label;

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
      toast.error(`Failed to update the ${label.toLowerCase()} colour.`);
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
            Enter a hex colour such as #ff6600.
          </span>
        ) : saved ? (
          `Custom for ${mode} mode.`
        ) : null
      }
      control={
        <div className="flex items-center gap-2">
          {saved ? (
            <button
              type="button"
              onClick={() => save(undefined)}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-8 w-8 items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:outline-none"
              aria-label={`Reset ${label.toLowerCase()} colour`}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          ) : null}
          <div className="border-input focus-within:ring-ring/50 focus-within:border-ring flex h-9 items-center gap-2 rounded-full border pr-3 pl-1.5 focus-within:ring-[3px]">
            <label
              className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full border"
              style={{ backgroundColor: swatch }}
            >
              <span className="sr-only">Pick {label.toLowerCase()} colour</span>
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
              placeholder={defaultColor ?? "Default"}
              aria-label={`${label} colour hex value`}
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
  return (
    <SettingsRow
      label="Advanced colours"
      description="Surfaces, lines, status, sidebar and chart colours."
      control={
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? "Hide" : "Show"}
        </Button>
      }
    />
  );
}

/** Clear every colour override for the mode in effect. */
export function ResetColorsSetting() {
  const { userPreferences, updateUserPreferences } = useSettings();
  const mode = useResolvedMode();
  const saved = parseAppearanceOverrides(userPreferences?.appearance)[mode];
  const count = saved ? Object.keys(saved).length : 0;
  return (
    <SettingsRow
      label="Reset colours"
      description={
        count
          ? `Restore all ${count} custom colour${count === 1 ? "" : "s"} for ${mode} mode.`
          : `No custom colours in ${mode} mode.`
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
            }).catch(() => toast.error("Failed to reset colours."));
          }}
        >
          Reset all
        </Button>
      }
    />
  );
}
