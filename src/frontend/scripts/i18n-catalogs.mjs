// Check translated UI catalogs against their English source catalogs.
//
// Fails (exit 1) when a translated catalog is invalid JSON, contains a key that
// English no longer has, or changes a string's `{{placeholder}}` names. Keys
// missing from a beta locale are only reported: the runtime falls back to
// English for them. `--report` lists every missing key instead of counts.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));

/** Catalog sets: one directory per locale holding one JSON file per namespace. */
export const CATALOG_SETS = [
  { name: "web", root: "web/src/locales" },
  { name: "product-ui", root: "packages/product-ui/src/locales" },
];

export const SOURCE_LOCALE = "en";
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Flatten nested catalog objects to dotted keys; arrays and strings are leaves. */
export function flatten(catalog, prefix = "") {
  const entries = {};
  for (const [key, value] of Object.entries(catalog)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value))
      Object.assign(entries, flatten(value, dotted));
    else entries[dotted] = value;
  }
  return entries;
}

/** A key without its plural suffix, so `items_other` and `items_one` share `items`. */
export function baseKey(key) {
  return key.replace(PLURAL_SUFFIX, "");
}

/** Interpolation names in a string or string array, ignoring formats such as `, lowercase`. */
export function placeholders(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return [...text.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

/** Compare one translated namespace with English. */
export function compareCatalogs(source, translated) {
  const sourceEntries = flatten(source);
  const translatedEntries = flatten(translated);
  const sourceBases = new Map();
  for (const [key, value] of Object.entries(sourceEntries)) {
    const base = baseKey(key);
    const names = sourceBases.get(base) ?? new Set();
    for (const name of placeholders(value)) names.add(name);
    sourceBases.set(base, names);
  }
  const stale = [];
  const placeholderMismatches = [];
  const translatedBases = new Set();
  for (const [key, value] of Object.entries(translatedEntries)) {
    const base = baseKey(key);
    if (!sourceBases.has(base)) {
      stale.push(key);
      continue;
    }
    if (value === "" || (Array.isArray(value) && value.length === 0)) continue;
    translatedBases.add(base);
    const expected = sourceBases.get(base);
    // Plural forms may legitimately omit `count` (e.g. "one item"), so only
    // names English never uses are errors for them.
    const unknown = placeholders(value).filter((name) => !expected.has(name));
    const missing = PLURAL_SUFFIX.test(key)
      ? []
      : [...expected].filter((name) => !placeholders(value).includes(name));
    if (unknown.length || missing.length)
      placeholderMismatches.push({ key, unknown, missing });
  }
  const missing = [...sourceBases.keys()].filter(
    (base) => !translatedBases.has(base),
  );
  return { stale, placeholderMismatches, missing };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/** Load `{ locale: { namespace: catalog } }` for one catalog set. */
export async function loadCatalogSet(set, root = frontendRoot) {
  const directory = path.join(root, set.root);
  const locales = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const namespaces = {};
    for (const file of await readdir(path.join(directory, entry.name))) {
      if (!file.endsWith(".json")) continue;
      namespaces[file.slice(0, -".json".length)] = await readJson(
        path.join(directory, entry.name, file),
      );
    }
    locales[entry.name] = namespaces;
  }
  return locales;
}

/** Check every catalog set; returns `{ errors, report }` lines. */
export async function checkCatalogs({
  root = frontendRoot,
  detailed = false,
} = {}) {
  const errors = [];
  const report = [];
  for (const set of CATALOG_SETS) {
    const locales = await loadCatalogSet(set, root);
    const english = locales[SOURCE_LOCALE];
    if (!english) {
      errors.push(`${set.name}: no ${SOURCE_LOCALE} catalogs`);
      continue;
    }
    for (const [locale, namespaces] of Object.entries(locales)) {
      if (locale === SOURCE_LOCALE) continue;
      for (const namespace of Object.keys(namespaces)) {
        if (!english[namespace])
          errors.push(
            `${set.name} ${locale}/${namespace}: namespace has no English catalog`,
          );
      }
      for (const [namespace, source] of Object.entries(english)) {
        const { stale, placeholderMismatches, missing } = compareCatalogs(
          source,
          namespaces[namespace] ?? {},
        );
        for (const key of stale)
          errors.push(
            `${set.name} ${locale}/${namespace}: "${key}" is not in English`,
          );
        for (const { key, unknown, missing: absent } of placeholderMismatches) {
          errors.push(
            `${set.name} ${locale}/${namespace}: "${key}" placeholders differ from English` +
              `${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}` +
              `${absent.length ? ` (missing: ${absent.join(", ")})` : ""}`,
          );
        }
        if (missing.length === 0) continue;
        report.push(
          `${set.name} ${locale}/${namespace}: ${missing.length} missing`,
        );
        if (detailed) for (const key of missing) report.push(`  ${key}`);
      }
    }
  }
  return { errors, report };
}

async function main() {
  const detailed = process.argv.includes("--report");
  const { errors, report } = await checkCatalogs({ detailed });
  if (report.length) {
    console.log("Untranslated keys (shown in English at runtime):");
    for (const line of report) console.log(`  ${line}`);
  } else {
    console.log("Every translated catalog is complete.");
  }
  if (errors.length) {
    console.error("Catalog errors:");
    for (const line of errors) console.error(`  ${line}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
