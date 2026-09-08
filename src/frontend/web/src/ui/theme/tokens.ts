export const THEME_VAR_NAMES = [
  "--background",
  "--foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
] as const;

export type ThemeVarName = (typeof THEME_VAR_NAMES)[number];

/**
 * Store full CSS color strings (e.g. "hsl(222.2 47.4% 11.2%)" or "#0f172a").
 * These values are applied directly to the CSS variables.
 */
export type ThemeVars = Partial<Record<ThemeVarName, string>>;
