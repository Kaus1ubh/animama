import { readFileSync, readdirSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { checkImage } from "./effect-assets.mjs";
import { budgetForDefinition } from "./effect-check.mjs";

/**
 * `pnpm -s effects promote <items.json> [--dry-run]`: write owner-approved
 * Avatar Effects, and the Reactions and Gestures that use them, into
 * Included content.
 *
 * Run only when the owner has explicitly approved each item, on a task branch
 * that goes through a PR (the `animama-avatar-vfx` skill's Promote to
 * Included step). Items:
 *
 * - `{ "source", "stem", "mode": "add" }`: a new Included effect at
 *   `vfx/avatar/<stem>/`, with content ID `builtin:avatar-effect:<stem>`;
 * - `{ "source", "stem", "mode": "replace" }`: new art and settings for an
 *   existing Included effect, keeping its folder, content ID, version and
 *   name; files it no longer uses are removed;
 * - `{ "stem", "mode": "delete" }`: remove an Included effect that no
 *   Included content depends on (after this run's replacements);
 * - `{ "kind": "reaction" | "gesture", "stem", "source", "mode": "replace" }`:
 *   the clip and dependencies of `reactions/<stem>/` or `gestures/<stem>/`
 *   from a creator project file (`animamaActionProject/1.0`, relative to the
 *   items file). The Included meta (content ID, version, name, placement
 *   hint) is kept, and the clip must keep its id, role and lifetime;
 *   Reactions stay expression-only. A dependency on a Local effect promoted
 *   in the same run is re-pointed at its Included ID; every other dependency
 *   must be Included content after the run, and every effect event must
 *   name a declared dependency. An unchanged item writes nothing.
 *
 * `source` is the reviewed effect: `library:local/<name>` (the saved Local
 * item, read from the sourced stack's `ANIMAMA_LOCAL_CONTENT_HOST_PATH`) or
 * an effect folder relative to the items file. `name` and `description` may
 * override the source's for an add; `description` for a replace.
 *
 * Effect files are covered by the existing `vfx/avatar/**\/*` licence rule,
 * so the inventory is not changed. Every written file gets a
 * `licenses/source-review.json` record in the same form as the existing
 * Included effect files; deleted files lose theirs. `--dry-run` lists every
 * change and writes nothing.
 */

export class EffectPromoteError extends Error {}

const STEM = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const EFFECT_ROOT = "content/included/vfx/avatar";
const INVENTORY_RULE = "vfx/avatar/**/*";
const KINDS = ["avatar_effect", "reaction", "gesture"];
/** Where each kind of Action lives in Included content. */
const ACTION_ROOTS = {
  reaction: "content/included/reactions",
  gesture: "content/included/gestures",
};
const ACTION_PROJECT_SCHEMA = "animamaActionProject/1.0";
/** Clip tracks that move the body, which an Included Reaction never has. */
const HUMANOID_TRACKS = ["rotations", "hipsPosition", "hands"];
/** The dependency type each effect event plays. */
const EVENT_CONTENT_TYPES = {
  avatar_vfx: "avatar_effect",
  particle_vfx: "particle_effect",
};

/** Repository paths the tool reads or writes, relative to the repository root. */
export const EFFECT_PROMOTE_PATHS = {
  effects: EFFECT_ROOT,
  inventory: "content/included/licenses/inventory.json",
  sourceReview: "licenses/source-review.json",
};

/** Parse and validate `items.json` (sources stay unresolved specs). */
export function parseEffectPromoteItems(value, itemsFile) {
  if (!Array.isArray(value) || value.length === 0)
    throw new EffectPromoteError(
      `${itemsFile}: expected a non-empty array of items.`,
    );
  const stems = new Set();
  return value.map((item, index) => {
    const where = `${itemsFile} item ${index + 1}`;
    const kind = item?.kind ?? "avatar_effect";
    if (!KINDS.includes(kind))
      throw new EffectPromoteError(
        `${where}: "kind" must be "avatar_effect", "reaction" or "gesture".`,
      );
    if (kind !== "avatar_effect" && item.mode !== "replace")
      throw new EffectPromoteError(
        `${where}: a ${kind} item replaces an Included ${kind} ("mode": "replace").`,
      );
    if (!["add", "replace", "delete"].includes(item?.mode))
      throw new EffectPromoteError(
        `${where}: "mode" must be "add", "replace" or "delete".`,
      );
    if (typeof item.stem !== "string" || !STEM.test(item.stem))
      throw new EffectPromoteError(
        `${where}: "stem" must be lowercase letters and digits joined by "_" or "-".`,
      );
    if (stems.has(`${kind}:${item.stem}`))
      throw new EffectPromoteError(
        `${where}: ${kind} stem "${item.stem}" repeats.`,
      );
    stems.add(`${kind}:${item.stem}`);
    if (item.mode === "delete") {
      if (item.source !== undefined)
        throw new EffectPromoteError(`${where}: a delete takes no "source".`);
    } else if (typeof item.source !== "string" || !item.source.trim())
      throw new EffectPromoteError(
        `${where}: "source" must be a non-empty string.`,
      );
    for (const field of ["name", "description"])
      if (
        item[field] !== undefined &&
        (typeof item[field] !== "string" || !item[field].trim())
      )
        throw new EffectPromoteError(
          `${where}: "${field}" must be a non-empty string.`,
        );
    if (item.mode !== "add" && item.name !== undefined)
      throw new EffectPromoteError(
        `${where}: only an add sets "name"; a ${item.mode} keeps it.`,
      );
    if (kind !== "avatar_effect" && item.description !== undefined)
      throw new EffectPromoteError(
        `${where}: a ${kind} replace keeps the Included description.`,
      );
    return {
      kind,
      mode: item.mode,
      stem: item.stem,
      source: item.source?.trim(),
      name: item.name?.trim(),
      description: item.description?.trim(),
    };
  });
}

const jsonFile = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Plan every change without touching the disk. `item.effect` is the resolved
 * effect source (`resolveEffectSource`'s result, whose `contentId` a
 * Reaction may depend on) for adds and replaces; `item.project` the parsed
 * creator project for a Reaction or Gesture.
 *
 * `repo` reads the working tree: `read(relative)` returns text or null,
 * `readBytes(relative)` a Buffer, `list(relative)` file names in a folder (or
 * null), and `includedMetas()` every Included descriptor (a JSON file with a
 * `content_id` or `dependencies`) as `{ path, value }`. `validate(definition)`
 * throws for an invalid `/2` definition and `validateClip(clip)` for an
 * invalid `animaPoseClip/2.0` clip (the app's validators). Returns
 * `[{ path, action, content? }]`, `action` being "create", "update" or
 * "delete".
 */
export async function planEffectPromotion(
  items,
  { repo, validate, validateClip },
) {
  const writes = new Map();
  const deletes = new Set();
  const readJson = (relative) => {
    const text = writes.has(relative)
      ? writes.get(relative)
      : repo.read(relative);
    if (text === null) throw new EffectPromoteError(`${relative} is missing.`);
    return JSON.parse(text);
  };
  const inventory = readJson(EFFECT_PROMOTE_PATHS.inventory);
  if (!inventory.rules?.some((rule) => rule.glob === INVENTORY_RULE))
    throw new EffectPromoteError(
      `${EFFECT_PROMOTE_PATHS.inventory}: no "${INVENTORY_RULE}" rule covers effect files.`,
    );
  const sourceReview = readJson(EFFECT_PROMOTE_PATHS.sourceReview);
  const template = sourceReview.files.find((entry) =>
    entry.path.startsWith(`${EFFECT_ROOT}/`),
  );
  if (!template)
    throw new EffectPromoteError(
      "no source-review record of an Included effect to follow.",
    );
  const { path: _path, ...recordFields } = template;

  const kindOf = (item) => item.kind ?? "avatar_effect";
  const effectItems = items.filter((item) => kindOf(item) === "avatar_effect");
  const metas = await repo.includedMetas();

  // Content IDs that are Included after this run, and the Included ID each
  // promoted effect source becomes.
  const effectContentId = (stem) => `builtin:avatar-effect:${stem}`;
  const includedIds = new Set(
    metas
      .map(({ value }) => value.content_id)
      .filter((id) => typeof id === "string"),
  );
  const promotedRefs = new Map();
  for (const item of effectItems)
    if (item.mode === "delete") includedIds.delete(effectContentId(item.stem));
    else {
      includedIds.add(effectContentId(item.stem));
      if (item.effect?.contentId)
        promotedRefs.set(item.effect.contentId, effectContentId(item.stem));
    }

  // Reactions and Gestures first, so a delete sees their new dependencies.
  const plannedMetas = new Map();
  for (const item of items)
    if (kindOf(item) !== "avatar_effect") {
      const planned = planAction(item, kindOf(item), {
        repo,
        validateClip,
        includedIds,
        promotedRefs,
      });
      for (const [relative, content] of planned.writes)
        writes.set(relative, content);
      plannedMetas.set(planned.metaPath, planned.meta);
    }
  const currentMetas = metas.map((meta) =>
    plannedMetas.has(meta.path)
      ? { path: meta.path, value: plannedMetas.get(meta.path) }
      : meta,
  );

  for (const item of effectItems) {
    const folder = `${EFFECT_ROOT}/${item.stem}`;
    const descriptorPath = `${folder}/${item.stem}.json`;
    const existingFiles = repo.list(folder);
    const original = existingFiles ? readJson(descriptorPath) : null;
    const contentId = effectContentId(item.stem);

    if (item.mode === "delete") {
      if (!original)
        throw new EffectPromoteError(
          `${item.stem}: no Included effect to delete.`,
        );
      const dependents = currentMetas
        .filter(
          ({ path: metaPath, value }) =>
            !metaPath.startsWith(`${folder}/`) &&
            (value.dependencies ?? []).some(
              (dependency) => dependency.ref === contentId,
            ),
        )
        .map(({ path: metaPath }) => metaPath);
      if (dependents.length)
        throw new EffectPromoteError(
          `${item.stem}: still used by ${dependents.join(", ")}; re-point them first.`,
        );
      for (const file of existingFiles) deletes.add(`${folder}/${file}`);
      continue;
    }

    const { effect } = item;
    if (item.mode === "add" && original)
      throw new EffectPromoteError(
        `${item.stem}: an Included effect already uses this stem; use mode "replace".`,
      );
    if (item.mode === "replace" && !original)
      throw new EffectPromoteError(
        `${item.stem}: no Included effect to replace.`,
      );
    const dependencies = effect.dependencies ?? [];
    if (dependencies.length || effect.definition.soundAlias)
      throw new EffectPromoteError(
        `${item.stem}: the source has a sound or other dependencies; Included effects are promoted without them.`,
      );
    try {
      validate(effect.definition);
    } catch (error) {
      throw new EffectPromoteError(`${item.stem}: ${error.message}`);
    }
    const images = [
      { name: effect.definition.art.image, file: effect.imagePath },
      ...(effect.otherImagePath
        ? [
            {
              name: effect.definition.art.otherEyeImage,
              file: effect.otherImagePath,
            },
          ]
        : []),
    ];
    // Image names become Included paths and source-review records: plain,
    // distinct file names only.
    for (const image of images)
      if (
        typeof image.name !== "string" ||
        path.basename(image.name) !== image.name ||
        image.name === "." ||
        image.name === ".." ||
        image.name.includes("\\")
      )
        throw new EffectPromoteError(
          `${item.stem}: image "${image.name}" must be a plain file name in the effect folder.`,
        );
    if (images.length === 2 && images[0].name === images[1].name)
      throw new EffectPromoteError(
        `${item.stem}: art.image and art.otherEyeImage must be different files.`,
      );
    if (images.some((image) => image.name === `${item.stem}.json`))
      throw new EffectPromoteError(
        `${item.stem}: an image cannot be named like the descriptor.`,
      );
    const budget = budgetForDefinition(effect.definition);
    for (const image of images) {
      const fails = (await checkImage(image.file, { budget })).issues.filter(
        (issue) => issue.level === "FAIL",
      );
      if (fails.length)
        throw new EffectPromoteError(
          `${item.stem}: ${image.name} fails the art check: ${fails.map((issue) => issue.message).join("; ")}`,
        );
    }
    const descriptor =
      item.mode === "replace"
        ? {
            ...original,
            description: item.description ?? original.description,
            dependencies: [],
            definition: effect.definition,
            files: images.map((image) => ({ path: image.name, role: "image" })),
          }
        : {
            schema_version: 1,
            content_type: "avatar_effect",
            content_id: contentId,
            version: 1,
            name: item.name ?? effect.name,
            description: item.description ?? effect.description,
            dependencies: [],
            definition: effect.definition,
            files: images.map((image) => ({ path: image.name, role: "image" })),
          };
    writes.set(descriptorPath, jsonFile(descriptor));
    for (const image of images)
      writes.set(`${folder}/${image.name}`, await readFile(image.file));
    for (const file of existingFiles ?? [])
      if (!writes.has(`${folder}/${file}`)) deletes.add(`${folder}/${file}`);
  }

  // One record per written file, in the existing effect files' form.
  const written = [...writes.keys()].filter((relative) =>
    relative.startsWith(`${EFFECT_ROOT}/`),
  );
  const dropped = sourceReview.files
    .filter((entry) => deletes.has(entry.path))
    .map((entry) => entry.path);
  sourceReview.files = sourceReview.files.filter(
    (entry) => !deletes.has(entry.path) && !written.includes(entry.path),
  );
  for (const relative of written)
    sourceReview.files.push({ path: relative, ...recordFields });
  sourceReview.files.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  writes.set(EFFECT_PROMOTE_PATHS.sourceReview, jsonFile(sourceReview));

  const changes = [];
  for (const [relative, content] of writes) {
    const current = repo.readBytes(relative);
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (current && current.equals(next)) continue;
    changes.push({
      path: relative,
      action: current ? "update" : "create",
      content,
      ...(relative === EFFECT_PROMOTE_PATHS.sourceReview
        ? {
            notes: [
              ...written.map((file) => `record for ${file}`),
              ...dropped.map((file) => `no record for ${file}`),
            ],
          }
        : {}),
    });
  }
  for (const relative of deletes)
    changes.push({ path: relative, action: "delete" });
  return changes;
}

function hasTracks(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).some((track) =>
      Array.isArray(track) ? track.length > 0 : hasTracks(track),
    )
  );
}

/**
 * Plan one Reaction or Gesture replace: its clip and meta writes, and the
 * meta as it will be (for dependents checks).
 */
function planAction(
  item,
  kind,
  { repo, validateClip, includedIds, promotedRefs },
) {
  const fail = (message) => {
    throw new EffectPromoteError(`${item.stem}: ${message}`);
  };
  const folder = `${ACTION_ROOTS[kind]}/${item.stem}`;
  const metaPath = `${folder}/${item.stem}.meta.json`;
  const metaText = repo.read(metaPath);
  if (metaText === null) fail(`no Included ${kind} to replace.`);
  const original = JSON.parse(metaText);
  const sequence = (original.files ?? []).find(
    (file) => file?.role === "sequence",
  );
  if (
    typeof sequence?.path !== "string" ||
    path.posix.basename(sequence.path) !== sequence.path
  )
    fail(`the Included ${kind} names no clip file in its folder.`);
  const clipPath = `${folder}/${sequence.path}`;
  const clipText = repo.read(clipPath);
  if (clipText === null) fail(`${clipPath} is missing.`);
  const originalClip = JSON.parse(clipText);

  const { project } = item;
  if (project?.schema !== ACTION_PROJECT_SCHEMA)
    fail(`the source must be a creator project (${ACTION_PROJECT_SCHEMA}).`);
  if (project.intent !== kind)
    fail(`the source is a ${project.intent} project, not a ${kind}.`);
  const clip = project.sequence;
  try {
    validateClip(clip);
  } catch (error) {
    fail(error.message);
  }
  for (const key of ["id", "role", "playback"])
    if (JSON.stringify(clip[key]) !== JSON.stringify(originalClip[key]))
      fail(
        `a replace keeps the Included clip's ${key} (${JSON.stringify(originalClip[key])}).`,
      );
  if (kind === "reaction")
    for (const track of HUMANOID_TRACKS)
      if (hasTracks(clip[track]))
        fail(`Reactions are expression-only; the clip has ${track} tracks.`);

  const dependencies = [];
  const declared = new Map();
  for (const dependency of Array.isArray(project.dependencies)
    ? project.dependencies
    : []) {
    const { alias, ref, content_type: contentType } = dependency ?? {};
    if (
      typeof alias !== "string" ||
      typeof ref !== "string" ||
      typeof contentType !== "string"
    )
      fail('each dependency needs "alias", "ref" and "content_type".');
    if (declared.has(alias)) fail(`dependency alias "${alias}" repeats.`);
    const included = promotedRefs.get(ref) ?? ref;
    if (!includedIds.has(included))
      fail(
        `dependency "${alias}" (${ref}) is not Included content after this promotion; promote it in the same run.`,
      );
    declared.set(alias, contentType);
    dependencies.push({
      ref: included,
      alias,
      content_type: contentType,
      config: dependency.config ?? {},
    });
  }
  for (const event of Array.isArray(clip.events) ? clip.events : []) {
    const contentType = EVENT_CONTENT_TYPES[event?.kind];
    if (contentType && declared.get(event.effectId) !== contentType)
      fail(
        `event "${event.id}" plays "${event.effectId}", which no dependency declares as a ${contentType.replace("_", " ")}.`,
      );
  }

  const meta = { ...original, dependencies };
  return {
    metaPath,
    meta,
    writes: [
      // Included clips are stored compact, metas indented.
      [clipPath, `${JSON.stringify(clip)}\n`],
      [metaPath, jsonFile(meta)],
    ],
  };
}

/** A repository reader over the working tree at `root`. */
export function workingTreeRepo(root) {
  return {
    read(relative) {
      const bytes = this.readBytes(relative);
      return bytes === null ? null : bytes.toString("utf8");
    },
    readBytes(relative) {
      try {
        return readFileSync(path.join(root, relative));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    list(relative) {
      try {
        return readdirSync(path.join(root, relative), { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort();
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async includedMetas() {
      const metas = [];
      const walk = async (relative) => {
        for (const entry of await readdir(path.join(root, relative), {
          withFileTypes: true,
        })) {
          const child = `${relative}/${entry.name}`;
          if (entry.isDirectory()) await walk(child);
          else if (
            entry.name.endsWith(".json") &&
            !entry.name.endsWith(".review.json")
          ) {
            try {
              const value = JSON.parse(
                await readFile(path.join(root, child), "utf8"),
              );
              if (
                typeof value?.content_id === "string" ||
                Array.isArray(value?.dependencies)
              )
                metas.push({ path: child, value });
            } catch {
              // Not a descriptor.
            }
          }
        }
      };
      await walk("content/included");
      return metas;
    },
  };
}

/** Apply planned changes under `root`, removing folders a delete empties. */
export async function applyEffectPromotion(root, changes) {
  for (const change of changes) {
    const target = path.join(root, change.path);
    if (change.action === "delete") {
      await rm(target, { force: true });
      await rmdir(path.dirname(target)).catch(() => {});
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, change.content);
    }
  }
}
