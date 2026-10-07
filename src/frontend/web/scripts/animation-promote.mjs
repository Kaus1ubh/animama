import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Promote owner-approved animaPoseClip/2.0 Gestures to Included content.
 *
 *   pnpm -s animation promote <items.json> [--dry-run]
 *
 * Run only with the owner's explicit approval of each item and of its licence
 * entries, on a task branch that goes through a PR (see the animama-animation
 * skill's "Promote to Included" step). `items.json` reuses `animation:save`'s
 * items (`clip`, `name`, `aiDescription`, `selectorId`, optional Library
 * `description`) and adds:
 *
 * - `mode`: `"add"` for a new Included Gesture, or `"replace"` to give an
 *   existing one new bytes. A replacement keeps the original's folder, content
 *   ID, Selector ID, name and loop/one-shot kind;
 * - `slug` (optional): the Included folder and content ID suffix; defaults to
 *   the clip file name without `.clip.json`;
 * - `licence`: the `licenses/inventory.json` rule fields (`creator`,
 *   `provenance`, `license_id`, `redistribution_review`) for the item's files;
 * - `sourceReview`: the `licenses/source-review.json` record fields
 *   (`candidate_license`, `basis`, `copyright`, `review`).
 *
 * For each item it writes `content/included/gestures/<slug>/<slug>.json` and
 * `<slug>.meta.json`, a byte-identical frontend mirror under
 * `poses/json/clips/` (registered in `pose_catalog.json`), a licence rule ahead
 * of the generic `gestures/**\/*.json` rule, and source-review records. A
 * replacement also drops the replaced 1.0 clip's pinned samples from
 * `starter-clip-samples-before-reduction.json`. `--dry-run` lists every file
 * it would write and writes nothing. New files must be `git add`ed before the
 * backend Included-content tests, which read tracked files only.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SELECTOR_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const LICENCE_FIELDS = [
  "creator",
  "provenance",
  "license_id",
  "redistribution_review",
];
const SOURCE_REVIEW_FIELDS = [
  "candidate_license",
  "basis",
  "copyright",
  "review",
];
const GENERIC_GESTURE_RULE = "gestures/**/*.json";

/** Repository paths the tool writes, relative to the repository root. */
export const PROMOTE_PATHS = {
  included: "content/included",
  inventory: "content/included/licenses/inventory.json",
  sourceReview: "licenses/source-review.json",
  mirror: "src/frontend/web/src/lib/avatar/poses/json/clips",
  poseCatalog: "src/frontend/web/src/lib/avatar/poses/pose_catalog.json",
  clipSamples:
    "src/frontend/web/src/lib/avatar/poses/fixtures/starter-clip-samples-before-reduction.json",
};

function requireText(value, where) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${where} must be a non-empty string.`);
  return value.trim();
}

function requireFields(value, fields, where) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${where} must be an object with ${fields.join(", ")}.`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key));
  if (unknown.length)
    throw new Error(`${where} has unknown field(s): ${unknown.join(", ")}.`);
  return Object.fromEntries(
    fields.map((field) => [
      field,
      requireText(value[field], `${where}.${field}`),
    ]),
  );
}

/** A promotion item as the tool uses it, or a thrown error naming the problem. */
export function parsePromoteItems(value, itemsFile) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${itemsFile}: expected a non-empty array of items.`);
  const slugs = new Set();
  const selectorIds = new Set();
  return value.map((item, index) => {
    const where = `${itemsFile} item ${index + 1}`;
    const clip = path.resolve(
      path.dirname(itemsFile),
      requireText(item?.clip, `${where}: "clip"`),
    );
    if (item.mode !== "add" && item.mode !== "replace")
      throw new Error(`${where}: "mode" must be "add" or "replace".`);
    const slug =
      item.slug === undefined
        ? path.basename(clip).replace(/\.clip\.json$|\.json$/, "")
        : requireText(item.slug, `${where}: "slug"`);
    if (!SLUG.test(slug))
      throw new Error(`${where}: slug "${slug}" must be lowercase kebab-case.`);
    const selectorId = requireText(item.selectorId, `${where}: "selectorId"`);
    if (!SELECTOR_ID.test(selectorId))
      throw new Error(`${where}: Selector ID "${selectorId}" is not valid.`);
    if (slugs.has(slug)) throw new Error(`${where}: slug "${slug}" repeats.`);
    if (selectorIds.has(selectorId))
      throw new Error(`${where}: Selector ID "${selectorId}" repeats.`);
    slugs.add(slug);
    selectorIds.add(selectorId);
    return {
      clip,
      slug,
      mode: item.mode,
      name: requireText(item.name, `${where}: "name"`),
      aiDescription: requireText(
        item.aiDescription,
        `${where}: "aiDescription"`,
      ),
      description:
        item.description === undefined
          ? undefined
          : requireText(item.description, `${where}: "description"`),
      selectorId,
      licence: requireFields(
        item.licence,
        LICENCE_FIELDS,
        `${where}: "licence"`,
      ),
      sourceReview: requireFields(
        item.sourceReview,
        SOURCE_REVIEW_FIELDS,
        `${where}: "sourceReview"`,
      ),
    };
  });
}

const jsonFile = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Plan every file write for the items without touching the disk.
 *
 * `repo` reads the current repository: `read(relativePath)` returns the text
 * or `null`, `gestureSlugs()` lists the Included Gesture folders.
 * `compactClip(value)` validates a clip and returns `{ ok, clip, saved }` or
 * `{ ok: false, message }` (the motion CLI's `compactClipFile`).
 * `formatJson(value)` formats the clip files and `pose_catalog.json`
 * (prettier's JSON style). `maxClipBytes` is the largest clip file the app
 * loads (`MAX_ANIMA_POSE_CLIP_BYTES`).
 * Returns `[{ path, action: "create" | "update", content }]` in write order.
 */
export async function planPromotion(
  items,
  { repo, compactClip, formatJson, maxClipBytes },
) {
  const writes = new Map();
  const current = (relative) =>
    writes.has(relative) ? writes.get(relative) : repo.read(relative);
  const put = (relative, content) => writes.set(relative, content);
  const readJson = (relative) => {
    const text = current(relative);
    if (text === null) throw new Error(`${relative} is missing.`);
    return JSON.parse(text);
  };

  const includedMetas = new Map();
  for (const slug of await repo.gestureSlugs()) {
    const text = repo.read(
      `${PROMOTE_PATHS.included}/gestures/${slug}/${slug}.meta.json`,
    );
    if (text !== null) includedMetas.set(slug, JSON.parse(text));
  }

  const inventory = readJson(PROMOTE_PATHS.inventory);
  const sourceReview = readJson(PROMOTE_PATHS.sourceReview);
  const poseCatalog = readJson(PROMOTE_PATHS.poseCatalog);
  const clipSamples = readJson(PROMOTE_PATHS.clipSamples);

  for (const item of items) {
    const folder = `${PROMOTE_PATHS.included}/gestures/${item.slug}`;
    const clipPath = `${folder}/${item.slug}.json`;
    const metaPath = `${folder}/${item.slug}.meta.json`;
    const mirrorPath = `${PROMOTE_PATHS.mirror}/${item.slug}.json`;
    const original = includedMetas.get(item.slug);
    const holder = [...includedMetas].find(
      ([slug, meta]) =>
        meta.semantic_key === item.selectorId && slug !== item.slug,
    );
    if (holder)
      throw new Error(
        `${item.slug}: Selector ID "${item.selectorId}" belongs to Included Gesture "${holder[0]}".`,
      );

    let source;
    try {
      source = JSON.parse(await readFile(item.clip, "utf8"));
    } catch (error) {
      throw new Error(`${item.clip}: ${error.message}`);
    }
    const compacted = compactClip({
      ...source,
      id: item.slug,
      name: item.name,
    });
    if (!compacted.ok) throw new Error(`${item.slug}: ${compacted.message}`);
    // Prettier's JSON style, as for the other built-in copies (the mirror is
    // inside the frontend's prettier:check scope); measured as written.
    const clipBytes = await formatJson(JSON.parse(compacted.saved));
    const size = Buffer.byteLength(clipBytes);
    if (size > maxClipBytes)
      throw new Error(
        `${item.slug}: the Included file would be ${size} bytes, over the ${maxClipBytes} the app loads.`,
      );

    let meta;
    if (item.mode === "replace") {
      if (!original)
        throw new Error(`${item.slug}: no Included Gesture to replace.`);
      if (original.semantic_key !== item.selectorId)
        throw new Error(
          `${item.slug}: the Included Gesture's Selector ID is "${original.semantic_key}"; a replacement keeps it.`,
        );
      if (original.name !== item.name)
        throw new Error(
          `${item.slug}: the Included Gesture is named "${original.name}"; a replacement keeps its name.`,
        );
      if (original.implementation?.kind !== "anima_clip")
        throw new Error(
          `${item.slug}: only anima_clip Gestures can be replaced.`,
        );
      const previous = readJson(clipPath);
      if (Boolean(previous.loop) !== Boolean(compacted.clip.loop))
        throw new Error(
          `${item.slug}: the replacement must stay ${previous.loop ? "a loop" : "one-shot"}.`,
        );
      meta = { ...original, ai_description: item.aiDescription };
      if (item.description !== undefined) meta.description = item.description;
    } else {
      if (original || current(clipPath) !== null)
        throw new Error(
          `${item.slug}: an Included Gesture already uses this slug; use mode "replace".`,
        );
      meta = {
        schema_version: 1,
        content_type: "gesture",
        content_id: `builtin:gesture:${item.slug}`,
        version: 1,
        semantic_key: item.selectorId,
        name: item.name,
        ...(item.description === undefined
          ? {}
          : { description: item.description }),
        ai_description: item.aiDescription,
        implementation: { kind: "anima_clip", file_role: "sequence" },
        dependencies: [],
        files: [{ path: `${item.slug}.json`, role: "sequence" }],
      };
    }
    put(clipPath, clipBytes);
    put(metaPath, jsonFile(meta));
    // The built-in catalog's fallback copy must match Included byte for byte.
    put(mirrorPath, clipBytes);

    // A specific rule ahead of the generic rule, which records the owner's
    // authorship attestation and does not cover agent-made clips.
    const glob = `gestures/${item.slug}/*.json`;
    const rule = { glob, ...item.licence };
    inventory.rules = inventory.rules.filter((entry) => entry.glob !== glob);
    const generic = inventory.rules.findIndex(
      (entry) => entry.glob === GENERIC_GESTURE_RULE,
    );
    if (generic < 0)
      throw new Error(
        `${PROMOTE_PATHS.inventory}: no "${GENERIC_GESTURE_RULE}" rule.`,
      );
    inventory.rules.splice(generic, 0, rule);

    for (const file of [clipPath, metaPath, mirrorPath]) {
      sourceReview.files = sourceReview.files.filter(
        (entry) => entry.path !== file,
      );
      sourceReview.files.push({ path: file, ...item.sourceReview });
    }

    if (!poseCatalog.clips.some((entry) => entry.id === item.slug))
      poseCatalog.clips.push({
        id: item.slug,
        source: `./json/clips/${item.slug}.json`,
      });

    // Pinned samples describe the replaced 1.0 clip; a 2.0 clip samples
    // against an Avatar and is pinned by its bytes instead.
    clipSamples.clips = clipSamples.clips.filter(
      (entry) => entry.id !== item.slug,
    );
  }

  sourceReview.files.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  put(PROMOTE_PATHS.inventory, jsonFile(inventory));
  put(PROMOTE_PATHS.sourceReview, jsonFile(sourceReview));
  put(PROMOTE_PATHS.poseCatalog, await formatJson(poseCatalog));
  put(PROMOTE_PATHS.clipSamples, jsonFile(clipSamples));

  return [...writes]
    .filter(([relative, content]) => repo.read(relative) !== content)
    .map(([relative, content]) => ({
      path: relative,
      action: repo.read(relative) === null ? "create" : "update",
      content,
    }));
}

/** A repository reader over the working tree. */
export function workingTreeRepo(root, { readFileSync, readdirSync }) {
  return {
    read(relative) {
      try {
        return readFileSync(path.join(root, relative), "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    gestureSlugs() {
      return readdirSync(path.join(root, PROMOTE_PATHS.included, "gestures"), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    },
  };
}

const USAGE = `Usage: pnpm -s animation promote <items.json> [--dry-run]

Promote owner-approved 2.0 Gestures to Included content. Run only with the
owner's explicit approval of each item and its licence entries, on a task
branch and PR. Each item: { "clip", "name", "aiDescription", "selectorId",
"description"?, "mode": "add" | "replace", "slug"?, "licence": { creator, provenance,
license_id, redistribution_review }, "sourceReview": { candidate_license,
basis, copyright, review } }. --dry-run lists the files it would write.`;

/**
 * Run the promotion. `compactClip` and `maxClipBytes` come from the motion
 * CLI's modules, loaded by
 * `animation.mjs` through Vite. Returns the process exit code.
 */
export async function runPromote(
  argv,
  { repoRoot, cwd, compactClip, maxClipBytes, out },
) {
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((value) => value !== "--dry-run");
  if (argv.includes("--help") || positional.length !== 1) {
    out(USAGE);
    return argv.includes("--help") ? 0 : 2;
  }
  const itemsFile = path.resolve(cwd, positional[0]);
  const fs = await import("node:fs");
  const webRequire = createRequire(
    path.join(repoRoot, "src/frontend/web/package.json"),
  );
  const { default: prettier } = await import(
    pathToFileURL(webRequire.resolve("prettier")).href
  );
  let writes;
  try {
    const items = parsePromoteItems(
      JSON.parse(await readFile(itemsFile, "utf8")),
      itemsFile,
    );
    writes = await planPromotion(items, {
      repo: workingTreeRepo(repoRoot, fs),
      compactClip,
      maxClipBytes,
      formatJson: (value) =>
        prettier.format(JSON.stringify(value, null, 2), { parser: "json" }),
    });
  } catch (error) {
    out(`Promotion refused: ${error.message}`);
    return 1;
  }
  for (const { path: relative, action } of writes)
    out(`${dryRun ? "Would " : ""}${action} ${relative}`);
  if (dryRun) {
    out(`Dry run: ${writes.length} file(s) unchanged on disk.`);
    return 0;
  }
  for (const { path: relative, content } of writes) {
    const target = path.join(repoRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  out(
    `Wrote ${writes.length} file(s). git add them before running the backend Included-content tests, and update the pinned Gesture counts deliberately.`,
  );
  return 0;
}
