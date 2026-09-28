/**
 * App-wide colour overrides layered on the built-in light and dark themes.
 *
 * Each mode keeps its own optional colours in app preferences
 * (`appearance.light` / `appearance.dark`), keyed by `APPEARANCE_COLOR_TOKENS`.
 * Unset values keep the built-in tokens from `@animama/product-ui/theme.css`.
 */

export const APPEARANCE_MODES = ["light", "dark"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export type AppearanceColorGroup =
  | "basic"
  | "surfaces"
  | "lines"
  | "status"
  | "sidebar"
  | "charts";

/**
 * One overridable theme colour. `cssVar` is the token shown as the default;
 * `also` receives the same value (unless separately overridden) and `textVars`
 * receive black or white, whichever reads better on the colour.
 */
export type AppearanceColorToken = {
  key: string;
  label: string;
  group: AppearanceColorGroup;
  cssVar: string;
  also?: readonly string[];
  textVars?: readonly string[];
};

/** Basic tokens first; advanced ones override anything basic ones derived. */
export const APPEARANCE_COLOR_TOKENS: readonly AppearanceColorToken[] = [
  {
    key: "primary",
    label: "Primary",
    group: "basic",
    cssVar: "primary",
    also: ["ring", "sidebar-primary", "sidebar-ring"],
    textVars: ["primary-foreground", "sidebar-primary-foreground"],
  },
  {
    key: "secondary",
    label: "Secondary",
    group: "basic",
    cssVar: "secondary",
    textVars: ["secondary-foreground"],
  },
  {
    key: "accent",
    label: "Accent",
    group: "basic",
    cssVar: "accent",
    also: ["sidebar-accent"],
    textVars: ["accent-foreground", "sidebar-accent-foreground"],
  },
  {
    key: "background",
    label: "Background",
    group: "basic",
    cssVar: "background",
  },
  {
    key: "foreground",
    label: "Foreground",
    group: "basic",
    cssVar: "foreground",
    also: ["card-foreground", "popover-foreground", "sidebar-foreground"],
  },
  { key: "card", label: "Card", group: "surfaces", cssVar: "card" },
  { key: "popover", label: "Popover", group: "surfaces", cssVar: "popover" },
  { key: "muted", label: "Muted", group: "surfaces", cssVar: "muted" },
  {
    key: "muted_foreground",
    label: "Muted text",
    group: "surfaces",
    cssVar: "muted-foreground",
  },
  { key: "border", label: "Border", group: "lines", cssVar: "border" },
  { key: "input", label: "Input border", group: "lines", cssVar: "input" },
  {
    key: "ring",
    label: "Focus ring",
    group: "lines",
    cssVar: "ring",
    also: ["sidebar-ring"],
  },
  {
    key: "destructive",
    label: "Destructive",
    group: "status",
    cssVar: "destructive",
    textVars: ["destructive-foreground"],
  },
  { key: "sidebar", label: "Sidebar", group: "sidebar", cssVar: "sidebar" },
  {
    key: "sidebar_foreground",
    label: "Sidebar text",
    group: "sidebar",
    cssVar: "sidebar-foreground",
  },
  {
    key: "sidebar_primary",
    label: "Sidebar primary",
    group: "sidebar",
    cssVar: "sidebar-primary",
    textVars: ["sidebar-primary-foreground"],
  },
  {
    key: "sidebar_accent",
    label: "Sidebar accent",
    group: "sidebar",
    cssVar: "sidebar-accent",
    textVars: ["sidebar-accent-foreground"],
  },
  {
    key: "sidebar_border",
    label: "Sidebar border",
    group: "sidebar",
    cssVar: "sidebar-border",
  },
  ...[1, 2, 3, 4, 5].map(
    (index): AppearanceColorToken => ({
      key: `chart_${index}`,
      label: `Chart ${index}`,
      group: "charts",
      cssVar: `chart-${index}`,
    }),
  ),
];

export const APPEARANCE_COLOR_GROUP_LABELS: Record<
  AppearanceColorGroup,
  string
> = {
  basic: "Visual style",
  surfaces: "Surfaces",
  lines: "Lines",
  status: "Status",
  sidebar: "Sidebar",
  charts: "Charts",
};

export type AppearanceColorKey = string;
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
    for (const { key } of APPEARANCE_COLOR_TOKENS) {
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
 * CSS custom properties for one mode's overrides, in precedence order (later
 * declarations win). Surfaces derived from a custom background/foreground are
 * mixed so built-in panels do not clash; explicit advanced colours come last.
 */
export function appearanceOverrideDeclarations(
  overrides: AppearanceModeOverrides,
): string[] {
  const declarations: string[] = [];
  const set = (name: string, value: string) =>
    declarations.push(`--${name}: ${value};`);
  const mix = (percent: number) =>
    `color-mix(in oklab, var(--foreground) ${percent}%, var(--background))`;
  const apply = (token: AppearanceColorToken) => {
    const color = overrides[token.key];
    if (!color) return;
    set(token.cssVar, color);
    for (const name of token.also ?? []) set(name, color);
    const text = readableTextOn(color);
    for (const name of token.textVars ?? []) set(name, text);
  };

  const basic = APPEARANCE_COLOR_TOKENS.filter((t) => t.group === "basic");
  basic.forEach(apply);
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
  APPEARANCE_COLOR_TOKENS.filter((t) => t.group !== "basic").forEach(apply);
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
