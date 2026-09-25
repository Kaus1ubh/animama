/**
 * App-wide colour overrides layered on the built-in light and dark themes.
 *
 * Each mode keeps its own optional Accent, Background and Foreground colours in
 * app preferences (`appearance.light` / `appearance.dark`). Unset values keep
 * the built-in tokens from `@animama/product-ui/theme.css`.
 */

export const APPEARANCE_MODES = ["light", "dark"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export const APPEARANCE_COLOR_KEYS = [
  "accent",
  "background",
  "foreground",
] as const;
export type AppearanceColorKey = (typeof APPEARANCE_COLOR_KEYS)[number];

export type AppearanceModeOverrides = Partial<
  Record<AppearanceColorKey, string>
>;
export type AppearanceOverrides = Partial<
  Record<AppearanceMode, AppearanceModeOverrides>
>;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Normalize user input to lowercase `#rrggbb`, accepting `#rgb` and a missing
 * leading `#`. Returns null for anything else so invalid input never persists.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return HEX_COLOR.test(hex) ? hex : null;
}

/** Read stored preferences defensively; unknown or invalid values are dropped. */
export function parseAppearanceOverrides(value: unknown): AppearanceOverrides {
  if (!value || typeof value !== "object") return {};
  const result: AppearanceOverrides = {};
  for (const mode of APPEARANCE_MODES) {
    const stored = (value as Record<string, unknown>)[mode];
    if (!stored || typeof stored !== "object") continue;
    const colors: AppearanceModeOverrides = {};
    for (const key of APPEARANCE_COLOR_KEYS) {
      const color = normalizeHexColor((stored as Record<string, unknown>)[key]);
      if (color) colors[key] = color;
    }
    if (Object.keys(colors).length > 0) result[mode] = colors;
  }
  return result;
}

/** Relative luminance (WCAG) of a normalized `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Black or white, whichever reads better on the given colour. */
export function readableTextOn(hex: string): "#000000" | "#ffffff" {
  // Contrast against black exceeds contrast against white above ~0.179.
  return luminance(hex) > 0.179 ? "#000000" : "#ffffff";
}

/**
 * CSS custom properties for one mode's overrides. Surfaces derived from the
 * background (cards, sidebar, muted, borders) are mixed toward the foreground
 * so a custom background does not leave mismatched built-in panels.
 */
export function appearanceOverrideDeclarations(
  overrides: AppearanceModeOverrides,
): string[] {
  const declarations: string[] = [];
  const set = (name: string, value: string) =>
    declarations.push(`--${name}: ${value};`);
  const mix = (percent: number) =>
    `color-mix(in oklab, var(--foreground) ${percent}%, var(--background))`;

  if (overrides.accent) {
    const text = readableTextOn(overrides.accent);
    for (const name of ["primary", "ring", "sidebar-primary", "sidebar-ring"]) {
      set(name, overrides.accent);
    }
    set("primary-foreground", text);
    set("sidebar-primary-foreground", text);
  }
  if (overrides.foreground) {
    for (const name of [
      "foreground",
      "card-foreground",
      "popover-foreground",
      "sidebar-foreground",
    ]) {
      set(name, overrides.foreground);
    }
  }
  if (overrides.background) set("background", overrides.background);
  if (overrides.background || overrides.foreground) {
    set("card", mix(4));
    set("popover", mix(4));
    set("sidebar", mix(3));
    set("muted", mix(10));
    set("muted-foreground", mix(62));
    set("border", mix(16));
    set("input", mix(16));
    set("sidebar-border", mix(12));
  }
  return declarations;
}

/** Full stylesheet for both modes; empty when nothing is overridden. */
export function buildAppearanceOverrideCss(
  overrides: AppearanceOverrides,
): string {
  const rules: string[] = [];
  const light = appearanceOverrideDeclarations(overrides.light ?? {});
  const dark = appearanceOverrideDeclarations(overrides.dark ?? {});
  // `:root:not(.dark)` keeps light overrides from leaking into dark mode.
  if (light.length) rules.push(`:root:not(.dark) { ${light.join(" ")} }`);
  if (dark.length) rules.push(`:root.dark { ${dark.join(" ")} }`);
  return rules.join("\n");
}

const OVERRIDE_STYLE_ID = "animama-appearance-overrides";

/** Install, replace or remove the document-level override stylesheet. */
export function applyAppearanceOverrideCss(css: string): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(OVERRIDE_STYLE_ID);
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = OVERRIDE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}
