import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * `pnpm -s effects save <items.json>`: save reviewed effect sources as Local
 * Avatar Effects through the Avatar Effect creator, in a headless browser,
 * exactly as a person would: import the editor document, choose its images,
 * Save, then reopen and read the saved item back.
 *
 * `items.json` lists `{ source, name?, description? }`. `source` is an effect
 * folder or descriptor (relative to the items file); `name` and
 * `description` default to the descriptor's. A Local Avatar Effect with the
 * same name is revised (its item is opened and the document imported into
 * it); otherwise a new one is saved. It never equips anything.
 */

export class EffectSaveError extends Error {}

/**
 * The names Local content accepts, as the backend's `readable_entry_name`
 * (`content_save_service.py`): letters, digits, spaces, ".", "_" and "-",
 * starting with a letter or digit, at most 120 characters.
 */
const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;

/**
 * The Local folder a name saves to (the backend's `readable_entry_name`), or
 * a thrown `EffectSaveError` naming the rule.
 */
export function localEntryName(name) {
  const trimmed = name.trim();
  const folder = ENTRY_NAME.test(trimmed)
    ? trimmed
        .replace(/[ _]+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .toLowerCase()
    : "";
  if (!folder || folder === "." || folder === "..")
    throw new EffectSaveError(
      `"${name}" is not a valid Local name: use letters, digits, spaces, ".", "_" and "-", starting with a letter or digit (at most 120 characters).`,
    );
  return folder;
}

/** Parse and validate `items.json`; paths resolve from the items file. */
export function parseEffectSaveItems(value, itemsFile) {
  if (!Array.isArray(value) || value.length === 0)
    throw new EffectSaveError(
      `${itemsFile}: expected a non-empty array of items.`,
    );
  const names = new Set();
  return value.map((item, index) => {
    const where = `${itemsFile} item ${index + 1}`;
    if (typeof item?.source !== "string" || !item.source.trim())
      throw new EffectSaveError(
        `${where}: "source" must be a non-empty string.`,
      );
    for (const field of ["name", "description"])
      if (
        item[field] !== undefined &&
        (typeof item[field] !== "string" || !item[field].trim())
      )
        throw new EffectSaveError(
          `${where}: "${field}" must be a non-empty string.`,
        );
    const name = item.name?.trim();
    if (name && names.has(name))
      throw new EffectSaveError(`${where}: name "${name}" repeats.`);
    if (name) names.add(name);
    return {
      source: path.resolve(path.dirname(itemsFile), item.source),
      name,
      description: item.description?.trim(),
    };
  });
}

/** The creator's record of one image file. */
export async function editorImage(file) {
  const bytes = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const contentType = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  }[ext];
  if (!contentType)
    throw new EffectSaveError(
      `${file}: the creator accepts PNG, JPEG or WebP images.`,
    );
  return {
    logicalName: path.basename(file),
    originalName: path.basename(file),
    contentType,
    sizeBytes: (await stat(file)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Build the creator import document for an effect source, and the definition
 * the creator will save from it. `editor` holds the creator's own
 * `createAvatarEffectDocumentFromDefinition`, `buildAvatarEffectEditorExport`
 * and `avatarEffectDefinition`, loaded through Vite so both are exactly what
 * the creator writes.
 */
export async function importDocumentFor(effect, item, editor) {
  if (effect.definition.soundAlias)
    throw new EffectSaveError(
      `${effect.descriptorPath}: effects with a sound are saved by hand (choose the sound in the creator).`,
    );
  const document = editor.createAvatarEffectDocumentFromDefinition({
    name: item.name ?? effect.name,
    description: item.description ?? effect.description,
    definition: effect.definition,
    image: await editorImage(effect.imagePath),
    otherEyeImage: effect.otherImagePath
      ? await editorImage(effect.otherImagePath)
      : null,
    sound: null,
  });
  return {
    exportDocument: editor.buildAvatarEffectEditorExport(document),
    expectedDefinition: editor.avatarEffectDefinition(document),
  };
}

/** Drop `null` members recursively; the API projects unset fields as null. */
function withoutNulls(value) {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== null)
        .map(([key, child]) => [key, withoutNulls(child)]),
    );
  return value;
}

/**
 * Attachment fields the API fills with these defaults when the creator leaves
 * them out (`app/contracts/avatar_effect.py`); the creator's round trip
 * already drops default offsets, scales, rotations, mirror and mode.
 */
const API_ATTACHMENT_DEFAULTS = {
  body: { size: 0.2, facing: "camera" },
  sticker: { around: "head", size: 0.25 },
  silhouette: { fill: "pattern", patternScale: 1, scroll: { x: 0, y: 0 } },
};

/** Drop attachment fields that hold the API's default for their kind. */
function withoutApiDefaults(definition) {
  const attachment = definition.attachment;
  const defaults = API_ATTACHMENT_DEFAULTS[attachment?.kind];
  if (!defaults) return definition;
  return {
    ...definition,
    attachment: Object.fromEntries(
      Object.entries(attachment).filter(
        ([key, value]) =>
          !(key in defaults) ||
          JSON.stringify(value) !== JSON.stringify(defaults[key]),
      ),
    ),
  };
}

/**
 * The first JSON path where a saved definition differs from the expected
 * one, or null when they match. Nulls are dropped (the API projects unset
 * fields as null), then both go through `normalize`, which should round-trip
 * a definition through the creator so defaults compare equal, and lose the
 * attachment defaults the API fills for fields the creator leaves out. Image
 * names are left out (the creator may rename a file to keep the two images
 * distinct), but an other-eye image must be present on both sides or neither.
 */
export function definitionDifference(
  saved,
  expected,
  normalize = (value) => value,
) {
  const prepare = (definition) => {
    const normalized = withoutApiDefaults(
      withoutNulls(normalize(withoutNulls(definition))),
    );
    const {
      image: _image,
      otherEyeImage: _other,
      ...art
    } = normalized.art ?? {};
    // Names may differ, but an other-eye image must not appear or vanish.
    return canonical({
      ...normalized,
      art: { ...art, otherEyeImage: Boolean(_other) },
    });
  };
  const walk = (a, b, at) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      !Array.isArray(a)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const found = walk(a[key], b[key], `${at}.${key}`);
        if (found) return found;
      }
    }
    return `${at} (saved ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`;
  };
  return walk(prepare(saved), prepare(expected), "definition");
}

/** The Local item a save revises, or null for a new item. */
export function planEffectSave(name, libraryItems) {
  const local = libraryItems.filter(
    (entry) => entry.source === "local" && entry.name === name,
  );
  if (local.length > 1)
    throw new EffectSaveError(
      `several Local Avatar Effects are named "${name}"; rename one in the Library first.`,
    );
  return local[0] ? { itemId: local[0].item_id } : null;
}

/** Key-sorted JSON, so saved and source definitions compare by content. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

/**
 * Save each `{ item, effect, exportDocument, expectedDefinition }` in order
 * through the creator
 * at `origin`. `onSaved({ name, url, revised })` runs after each save is
 * reopened, so a later failure does not hide earlier saves.
 */
export async function saveEffects(
  jobs,
  origin,
  { normalize, onSaved = () => {} } = {},
) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      "--enable-unsafe-swiftshader",
    ],
  });
  try {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(240_000);
    // "Replace the current unsaved document?" when importing over a draft.
    page.on("dialog", (dialog) => void dialog.accept());
    let library;
    try {
      await page.goto("/");
      library = await page.evaluate(async () => {
        const response = await fetch("/v1/avatar-effects");
        if (!response.ok) throw new Error(`Library request ${response.status}`);
        return (await response.json()).items ?? [];
      });
    } catch (error) {
      throw new EffectSaveError(
        `could not reach the app at ${origin} (${error.message.split("\n")[0]}); start the stack and source its record.`,
      );
    }
    const nameBox = page.getByRole("textbox", {
      name: "Avatar FX name",
      exact: true,
    });
    for (const { item, effect, exportDocument, expectedDefinition } of jobs) {
      const name = exportDocument.document.name;
      let step = "plan the save";
      try {
        const target = planEffectSave(name, library);
        step = "open the creator";
        await page.goto(
          target
            ? `/avatar-effects/${encodeURIComponent(target.itemId)}/edit`
            : "/avatar-effects/new",
        );
        await nameBox.waitFor();
        if (target) {
          step = "load the saved item";
          await page.waitForFunction(
            (expected) =>
              document.querySelector('[aria-label="Avatar FX name"]')?.value ===
              expected,
            name,
            { timeout: 60_000 },
          );
        }
        step = "import the document";
        await page
          .getByRole("button", { name: "Import", exact: true })
          .first()
          .click();
        const dialog = page.getByRole("dialog", {
          name: "Import Avatar Effect JSON",
        });
        await dialog.getByRole("textbox").fill(JSON.stringify(exportDocument));
        await dialog
          .getByRole("button", { name: "Import document", exact: true })
          .click();
        await dialog.waitFor({ state: "hidden" });
        step = "choose the images";
        await page
          .getByLabel("Image", { exact: true })
          .setInputFiles(effect.imagePath);
        if (effect.otherImagePath)
          await page
            .getByLabel("Other side image (optional)", { exact: true })
            .setInputFiles(effect.otherImagePath);
        const save = page.getByRole("button", { name: "Save", exact: true });
        await save.waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[aria-label="Save"]')?.disabled,
          null,
          { timeout: 60_000 },
        );
        step = "save";
        const response = page.waitForResponse(
          (candidate) =>
            ["PUT", "POST", "PATCH"].includes(candidate.request().method()) &&
            /\/v1\/avatar-effects/.test(candidate.url()),
          { timeout: 120_000 },
        );
        response.catch(() => {});
        await save.click();
        const result = await response;
        if (!result.ok())
          throw new Error(
            `the app refused the save (${result.status()}): ${(await result.text()).slice(0, 300)}`,
          );
        await page
          .getByText("Avatar Effect saved.", { exact: true })
          .first()
          .waitFor({ timeout: 60_000 });
        if (!target)
          await page.waitForURL(/\/avatar-effects\/[^/]+\/edit/, {
            timeout: 60_000,
          });
        step = "read the saved item back";
        const itemId =
          target?.itemId ??
          decodeURIComponent(
            new URL(page.url()).pathname.split("/").at(-2) ?? "",
          );
        const saved = await page.evaluate(async (id) => {
          const reply = await fetch(
            `/v1/avatar-effects/${encodeURIComponent(id)}`,
          );
          return reply.ok ? reply.json() : null;
        }, itemId);
        if (!saved?.definition)
          throw new Error("the saved item has no readable definition");
        const difference = definitionDifference(
          saved.definition,
          expectedDefinition,
          normalize,
        );
        if (difference)
          throw new Error(`the saved definition differs at ${difference}`);
        step = "reopen the saved item";
        const url = page.url();
        await page.reload();
        await page.waitForFunction(
          (expected) =>
            document.querySelector('[aria-label="Avatar FX name"]')?.value ===
            expected,
          name,
          { timeout: 60_000 },
        );
        onSaved({ name, url, revised: Boolean(target) });
      } catch (error) {
        throw new EffectSaveError(
          `${item.name ?? effect.stem}: could not ${step}: ${error.message.split("\n")[0]}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
}
