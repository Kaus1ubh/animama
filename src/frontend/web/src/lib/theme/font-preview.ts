/**
 * TEMPORARY typeface and body-weight preview (issue #320).
 *
 * Lets the installation owner compare candidate typefaces in daily use before
 * one is chosen. Remove this module, its Appearance setting, the unused
 * `@fontsource-variable/*` packages and their CSS imports once the typeface is
 * final, and set the chosen family and weight directly in the theme.
 *
 * The choice is a per-device convenience stored in local storage and applied
 * as CSS custom properties on the document root, which `globals.css` reads.
 */

import "@fontsource-variable/dm-sans";
import "@fontsource-variable/figtree";
import "@fontsource-variable/geist";
import "@fontsource-variable/onest";
import "@fontsource-variable/outfit";
import "@fontsource-variable/plus-jakarta-sans";

const STORAGE_KEY = "animama.fontPreview";
const FONT_VAR = "--app-font-sans";
const WEIGHT_VAR = "--app-body-weight";

export type FontPreviewOption = {
  key: string;
  label: string;
  /** CSS font-family list, or null to use the theme default. */
  family: string | null;
};

const SYSTEM_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const FONT_PREVIEW_OPTIONS: readonly FontPreviewOption[] = [
  { key: "nunito", label: "Nunito", family: null },
  {
    key: "figtree",
    label: "Figtree",
    family: `"Figtree Variable", ${SYSTEM_STACK}`,
  },
  {
    key: "plus-jakarta-sans",
    label: "Plus Jakarta Sans",
    family: `"Plus Jakarta Sans Variable", ${SYSTEM_STACK}`,
  },
  {
    key: "outfit",
    label: "Outfit",
    family: `"Outfit Variable", ${SYSTEM_STACK}`,
  },
  {
    key: "dm-sans",
    label: "DM Sans",
    family: `"DM Sans Variable", ${SYSTEM_STACK}`,
  },
  { key: "geist", label: "Geist", family: `"Geist Variable", ${SYSTEM_STACK}` },
  { key: "onest", label: "Onest", family: `"Onest Variable", ${SYSTEM_STACK}` },
  { key: "system", label: "System font", family: SYSTEM_STACK },
];

export const BODY_WEIGHT_OPTIONS = [400, 500, 600] as const;
export type BodyWeight = (typeof BODY_WEIGHT_OPTIONS)[number];

export type FontPreview = { font: string; weight: BodyWeight };

export const DEFAULT_FONT_PREVIEW: FontPreview = {
  font: "nunito",
  weight: 400,
};

function normalize(value: unknown): FontPreview {
  const record = (value ?? {}) as Partial<FontPreview>;
  const font = FONT_PREVIEW_OPTIONS.some((option) => option.key === record.font)
    ? (record.font as string)
    : DEFAULT_FONT_PREVIEW.font;
  const weight = BODY_WEIGHT_OPTIONS.includes(record.weight as BodyWeight)
    ? (record.weight as BodyWeight)
    : DEFAULT_FONT_PREVIEW.weight;
  return { font, weight };
}

/** The stored preview, or the default when storage is empty or unavailable. */
export function readFontPreview(): FontPreview {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_FONT_PREVIEW;
  }
}

/** Apply a preview to the document root; defaults clear the overrides. */
export function applyFontPreview(preview: FontPreview): void {
  const root = document.documentElement.style;
  const family = FONT_PREVIEW_OPTIONS.find(
    (option) => option.key === preview.font,
  )?.family;
  if (family) root.setProperty(FONT_VAR, family);
  else root.removeProperty(FONT_VAR);
  if (preview.weight === DEFAULT_FONT_PREVIEW.weight)
    root.removeProperty(WEIGHT_VAR);
  else root.setProperty(WEIGHT_VAR, String(preview.weight));
}

/** Store and apply a preview. Storage failures still apply it for this session. */
export function writeFontPreview(preview: FontPreview): void {
  const next = normalize(preview);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private or restricted storage: keep the in-session choice only.
  }
  applyFontPreview(next);
}

/**
 * Apply the stored preview at startup and follow changes made in other
 * windows of the same origin, such as the desktop picture-in-picture window.
 */
export function installFontPreview(): void {
  applyFontPreview(readFontPreview());
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) applyFontPreview(readFontPreview());
  });
}
