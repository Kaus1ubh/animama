import type { Catalog } from "@animama/product-ui/i18n";
import type { UiLocale } from "@animama/runtime-contracts/locale";

// English catalogs are the source and the fallback, so they are bundled.
const englishModules = import.meta.glob<Catalog>("../locales/en/*.json", {
  eager: true,
  import: "default",
});
// Every other catalog is its own chunk, loaded only for the active locale.
const translatedModules = import.meta.glob<Catalog>(
  ["../locales/*/*.json", "!../locales/en/*.json"],
  { import: "default" },
);

function namespaceOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -".json".length);
}

/** English catalogs keyed by namespace (one JSON file per namespace). */
export const SOURCE_CATALOGS: Readonly<Record<string, Catalog>> =
  Object.fromEntries(
    Object.entries(englishModules).map(([path, catalog]) => [
      namespaceOf(path),
      catalog,
    ]),
  );

/** The web application's namespaces, derived from its English catalogs. */
export const NAMESPACES: readonly string[] = Object.keys(SOURCE_CATALOGS);

/** Namespace used when a key has no `namespace:` prefix. */
export const DEFAULT_NAMESPACE = "common";

/** Load one namespace for a non-source locale; a missing file falls back to English. */
export async function loadCatalog(
  locale: UiLocale,
  namespace: string,
): Promise<Catalog> {
  const load = translatedModules[`../locales/${locale}/${namespace}.json`];
  return load ? load() : {};
}
