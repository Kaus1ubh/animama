import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sourceAssets } from "./effect-check.mjs";
import {
  includedActionDependencies,
  includedContentTypes,
  listIncludedMetas,
} from "./included-dependencies.mjs";

/**
 * `pnpm -s effects promote <items.json> [--dry-run]`: write owner-approved
 * Avatar, Particle and Scene Effects, and the Reactions and Gestures that use
 * them, into Included content.
 *
 * Run only when the owner has explicitly approved each item, on a task branch
 * that goes through a PR (the effect skills' Promote to Included step). Items:
 *
 * - `{ "kind"?, "source", "stem", "mode": "add" }`: a new Included effect.
 *   `kind` is `avatar_effect` (the default), `particle_effect` or
 *   `scene_effect`, written to `vfx/avatar/<stem>/` (content ID
 *   `builtin:avatar-effect:<stem>`), `vfx/particle/quark/<stem>/`
 *   (`builtin:particle-effect:<stem>`) or `vfx/scene/<stem>/`
 *   (`builtin:scene-effect:<lane>:<stem>`, the lane being `background` or
 *   `focus` after the Scene's kind);
 * - `{ "kind"?, "source", "stem", "mode": "replace" }`: new art and settings
 *   for an existing Included effect, keeping its folder, content ID, version
 *   and name (a Scene also keeps its kind, which its ID names); files it no
 *   longer uses are removed;
 * - `{ "kind"?, "stem", "mode": "delete" }`: remove an Included effect that no
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
 * item of the item's kind, read from the sourced stack's
 * `ANIMAMA_LOCAL_CONTENT_HOST_PATH`) or an effect folder relative to the items
 * file. `name` and `description` may override the source's for an add;
 * `description` for a replace. Effects are promoted without the source's
 * sounds or other dependencies, validated as the creator's Save validates
 * them, and their art re-checked against its budget; Scene art must be PNG.
 *
 * A built-in Avatar Effect plays at most one licensed sound from the private
 * comedy sound pack, as an optional dependency (ADR 0022). An add names it
 * with `"sound": "<key>"`, a sound in the tracked pack manifest, or chooses a
 * silent effect with `"sound": null`; a replace keeps the effect's current
 * sound unless it names another or `null` (which removes it).
 *
 * Licence records (D1): Avatar Effect files fall under the existing
 * `vfx/avatar/**\/*` rule and Scene PNGs under `vfx/scene/**\/*.png`. Each
 * promoted Particle Effect gets its own owner-authored rule,
 * `vfx/particle/quark/<stem>/**`, ahead of the generated-art rule, and loses
 * it when deleted. Every written file gets a `licenses/source-review.json`
 * record in the form of the Included Avatar Effect files, except a file whose
 * bytes repeat third-party Included art (such as a creator's built-in
 * texture): it keeps that file's record and, in an exact-path rule ahead of
 * the effect's own, its licence terms. Deleted files lose their records and
 * exact rules, and a removed or replaced third-party record is reported so
 * its evidence can be updated. `--dry-run` lists every change and writes
 * nothing.
 */

export class EffectPromoteError extends Error {}

const STEM = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
/**
 * Each effect kind: its Included folder, the kind `resolveAnyEffectSource`
 * reports for its sources, its name, and the licence rule its files need
 * (for Particle Effects, the rule each per-effect rule goes ahead of).
 */
const EFFECT_KINDS = {
  avatar_effect: {
    root: "content/included/vfx/avatar",
    source: "avatar",
    noun: "an Avatar Effect",
    rule: "vfx/avatar/**/*",
  },
  particle_effect: {
    root: "content/included/vfx/particle/quark",
    source: "particle",
    noun: "a Particle Effect",
    rule: "vfx/particle/quark/**",
  },
  scene_effect: {
    root: "content/included/vfx/scene",
    source: "scene",
    noun: "a Scene Effect",
    rule: "vfx/scene/**/*.png",
  },
};
const SOURCE_NOUNS = Object.fromEntries(
  Object.values(EFFECT_KINDS).map(({ source, noun }) => [source, noun]),
);
const KINDS = [...Object.keys(EFFECT_KINDS), "reaction", "gesture"];
/** The content ID lane of each Scene kind. */
const SCENE_LANES = { background_layers: "background", focus_lines: "focus" };
/** An Included Particle Effect's Quarks manifest, beside its descriptor. */
const PARTICLE_MANIFEST = "particle.json";
/**
 * A texture path inside a Particle Effect folder: a plain file name, at most
 * one folder deep (`textures/<name>.png`), so a delete clears every folder.
 */
const TEXTURE_FILE =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The owner-authored licence rule of one promoted Particle Effect (D1). */
const particleRule = (stem) => `vfx/particle/quark/${stem}/**`;
/** Where each kind of Action lives in Included content. */
const ACTION_ROOTS = {
  reaction: "content/included/reactions",
  gesture: "content/included/gestures",
};
const ACTION_PROJECT_SCHEMA = "animamaActionProject/1.0";
/**
 * Clip fields that move the body, which a Reaction never carries (the
 * creator's `sanitizeReactionSequence`; the runtime skips a Reaction with
 * humanoid channels).
 */
const REACTION_BODY_FIELDS = [
  "joints",
  "rotations",
  "hipsPosition",
  "hands",
  "contacts",
  "plantFeet",
  "basePose",
  "mutedProceduralLayers",
];
/** What a replace keeps from the Included clip: identity and lifetime. */
const KEPT_CLIP_FIELDS = ["id", "role", "playback", "loop"];

/** Repository paths the tool reads or writes, relative to the repository root. */
export const EFFECT_PROMOTE_PATHS = {
  inventory: "content/included/licenses/inventory.json",
  sourceReview: "licenses/source-review.json",
  soundManifest: "src/backend/animama/resources/wow-comedy-sfx-manifest.json",
};

/** A sound key in the comedy pack, from its vendor file name. */
const SOUND_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** The optional edge and alias a built-in effect uses for its licensed sound. */
const soundEdge = (key) => ({
  ref: `builtin:sound-effect:${key}`,
  content_type: "sound_effect",
  alias: "on-apply",
  optional: true,
});

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
        `${where}: "kind" must be one of ${KINDS.map((name) => `"${name}"`).join(", ")}.`,
      );
    const action = !EFFECT_KINDS[kind];
    if (action && item.mode !== "replace")
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
    if (action && item.description !== undefined)
      throw new EffectPromoteError(
        `${where}: a ${kind} replace keeps the Included description.`,
      );
    if (
      item.sound !== undefined &&
      (kind !== "avatar_effect" ||
        item.mode === "delete" ||
        (item.sound !== null &&
          (typeof item.sound !== "string" || !SOUND_KEY.test(item.sound))))
    )
      throw new EffectPromoteError(
        `${where}: "sound" names a comedy pack sound key (like "funny_sweat_02"), or null for no sound, on an Avatar Effect add or replace.`,
      );
    return {
      kind,
      mode: item.mode,
      stem: item.stem,
      source: item.source?.trim(),
      name: item.name?.trim(),
      description: item.description?.trim(),
      sound: item.sound,
    };
  });
}

const jsonFile = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Key-sorted JSON values, so records compare by content. */
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  return value;
}

/**
 * Whether a licence inventory glob matches a path below `content/included`,
 * as the content store's `fnmatch` does: `*` matches any run of characters
 * (slashes included) and `?` one character. The inventory uses no character
 * classes, so `[` and `]` match themselves.
 */
function globMatches(glob, relative) {
  const pattern = [...glob]
    .map((character) =>
      character === "*"
        ? ".*"
        : character === "?"
          ? "."
          : character.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${pattern}$`, "s").test(relative);
}

/** Whether `name` is a plain file name, safe as an Included path. */
function isPlainFileName(name) {
  return (
    typeof name === "string" &&
    path.basename(name) === name &&
    name !== "." &&
    name !== ".." &&
    !name.includes("\\")
  );
}

/**
 * Plan every change without touching the disk. `item.effect` is the resolved
 * effect source (`resolveAnyEffectSource`'s result, whose `contentId` a
 * Reaction may depend on, plus its descriptor's `dependencies`) for adds and
 * replaces; `item.project` the parsed creator project for a Reaction or
 * Gesture.
 *
 * `repo` reads the working tree: `read(relative)` returns text or null,
 * `readBytes(relative)` a Buffer, `list(relative)` the files below a folder
 * as relative paths (or null), `identicalIncludedFiles(bytes)` the Included
 * files holding exactly those bytes, and `includedMetas()` every Included
 * descriptor (a JSON file with a `content_id` or `dependencies`) as
 * `{ path, value }`. `validate(definition)` throws for an invalid `/2`
 * Avatar Effect definition, `validateParticle(effect)` and
 * `validateScene(effect)` for a Particle or Scene source the creator's Save
 * would refuse, and `validateClip(clip)` for an invalid
 * `animaPoseClip/2.0` clip (the app's validators). `formatJson(value)`
 * formats a changed indented clip file (the repository's Prettier JSON
 * style; compact clip files stay compact). Returns
 * `[{ path, action, content?, notes? }]`, `action` being "create", "update"
 * or "delete".
 */
export async function planEffectPromotion(
  items,
  {
    repo,
    validate,
    validateParticle,
    validateScene,
    validateClip,
    formatJson = (value) => `${JSON.stringify(value, null, 2)}\n`,
  },
) {
  const writes = new Map();
  const deletes = new Set();
  const notes = new Map();
  const readJson = (relative) => {
    const text = writes.has(relative)
      ? writes.get(relative)
      : repo.read(relative);
    if (text === null) throw new EffectPromoteError(`${relative} is missing.`);
    return JSON.parse(text);
  };
  let soundKeys = null;
  /** Sound keys in the tracked comedy pack manifest (read when first needed). */
  const packSounds = () => {
    soundKeys ??= new Set(
      (readJson(EFFECT_PROMOTE_PATHS.soundManifest).files ?? [])
        .map((file) => file.path)
        .filter((file) => file.endsWith(".ogg"))
        .map((file) => path.posix.basename(file, ".ogg")),
    );
    return soundKeys;
  };
  /**
   * The licensed sound edge an Avatar Effect add or replace writes: the one the
   * item names, none for `"sound": null`, else (for a replace) the effect's
   * current one.
   */
  const licensedSound = (item, original) => {
    const kept = (original?.dependencies ?? []).find(
      (edge) => edge.content_type === "sound_effect" && edge.optional === true,
    );
    if (item.sound === null) return null;
    if (item.mode === "add" && item.sound === undefined)
      throw new EffectPromoteError(
        `${item.stem}: choose the effect's licensed sound: name one with "sound", or set "sound": null for a silent effect.`,
      );
    if (item.sound === undefined) return kept ?? null;
    if (!packSounds().has(item.sound))
      throw new EffectPromoteError(
        `${item.stem}: "${item.sound}" is not a sound in the tracked comedy pack manifest.`,
      );
    return soundEdge(item.sound);
  };
  const kindOf = (item) => item.kind ?? "avatar_effect";
  const effectItems = items.filter((item) => EFFECT_KINDS[kindOf(item)]);

  const inventory = readJson(EFFECT_PROMOTE_PATHS.inventory);
  const ruleIndex = (glob) =>
    (inventory.rules ?? []).findIndex((rule) => rule.glob === glob);
  for (const kind of new Set(["avatar_effect", ...effectItems.map(kindOf)])) {
    const { rule, noun } = EFFECT_KINDS[kind];
    if (ruleIndex(rule) < 0)
      throw new EffectPromoteError(
        `${EFFECT_PROMOTE_PATHS.inventory}: no "${rule}" rule for the files of ${noun}.`,
      );
  }
  // Promoted art is owner-authored, worded like the Avatar Effect rule.
  const {
    creator,
    license_id: licenseId,
    redistribution_review: redistributionReview,
  } = inventory.rules[ruleIndex(EFFECT_KINDS.avatar_effect.rule)];
  const originalRules = [...inventory.rules];
  // Why each added rule exists, for the dry run.
  const ruleReasons = new Map();
  const sourceReview = readJson(EFFECT_PROMOTE_PATHS.sourceReview);
  const originalRecords = new Map(
    sourceReview.files.map((entry) => [entry.path, entry]),
  );
  const template = sourceReview.files.find((entry) =>
    entry.path.startsWith(`${EFFECT_KINDS.avatar_effect.root}/`),
  );
  if (!template)
    throw new EffectPromoteError(
      "no source-review record of an Included effect to follow.",
    );
  const { path: _path, ...recordFields } = template;
  const ownerForm = JSON.stringify(canonicalJson(recordFields));
  /**
   * The Included file whose bytes `bytes` repeat and whose record is not the
   * owner's (third-party art, such as a creator's built-in texture the
   * creator's Save copied), or null: its copy keeps that record and licence.
   */
  const thirdPartyOrigin = (bytes) => {
    for (const relative of repo.identicalIncludedFiles(bytes)) {
      const { path: _origin, ...record } = originalRecords.get(relative) ?? {};
      if (
        Object.keys(record).length &&
        JSON.stringify(canonicalJson(record)) !== ownerForm
      )
        return { path: relative, record };
    }
    return null;
  };
  const carried = new Map();

  // Each effect's Included folder and content ID, the content type of each
  // content ID Included after this run, and the Included ID each promoted
  // effect source becomes.
  const metas = await repo.includedMetas();
  const includedTypes = includedContentTypes(metas);
  const promotedRefs = new Map();
  const targets = new Map();
  for (const item of effectItems) {
    const kind = kindOf(item);
    const { root, source, noun } = EFFECT_KINDS[kind];
    const fail = (message) => {
      throw new EffectPromoteError(`${item.stem}: ${message}`);
    };
    const folder = `${root}/${item.stem}`;
    const files = repo.list(folder);
    const descriptorPath = `${folder}/${item.stem}.json`;
    const original = files ? readJson(descriptorPath) : null;
    if (item.mode === "add" && original)
      fail('an Included effect already uses this stem; use mode "replace".');
    if (item.mode !== "add" && !original)
      fail(`no Included effect to ${item.mode}.`);
    const { effect } = item;
    if (effect && (effect.kind ?? "avatar") !== source)
      fail(
        `the source is ${SOURCE_NOUNS[effect.kind] ?? effect.kind}, not ${noun}.`,
      );
    let contentId = original?.content_id;
    if (kind === "scene_effect" && effect) {
      const sceneKind = effect.definition?.kind;
      if (!SCENE_LANES[sceneKind])
        fail('the Scene kind must be "background_layers" or "focus_lines".');
      if (original && original.definition?.kind !== sceneKind)
        fail(
          `a replace keeps the Scene kind (${original.definition?.kind}), which its content ID names.`,
        );
      contentId ??= `builtin:scene-effect:${SCENE_LANES[sceneKind]}:${item.stem}`;
    }
    contentId ??= `builtin:${kind.replace("_", "-")}:${item.stem}`;
    if (item.mode === "delete") includedTypes.delete(contentId);
    else {
      includedTypes.set(contentId, kind);
      if (effect?.contentId) promotedRefs.set(effect.contentId, contentId);
    }
    targets.set(item, { folder, files, descriptorPath, original, contentId });
  }

  // Reactions and Gestures first, so a delete sees their new dependencies.
  const plannedMetas = new Map();
  for (const item of items)
    if (!EFFECT_KINDS[kindOf(item)]) {
      const planned = planAction(item, kindOf(item), {
        repo,
        validateClip,
        includedTypes,
        promotedRefs,
      });
      // An unchanged clip keeps its file as it is; a changed one keeps its
      // form (compact, or indented in the repository's style).
      const { clip, clipText } = planned;
      writes.set(
        planned.clipPath,
        JSON.stringify(clip) === JSON.stringify(JSON.parse(clipText))
          ? clipText
          : clipText.trimEnd().includes("\n")
            ? await formatJson(clip)
            : `${JSON.stringify(clip)}\n`,
      );
      writes.set(planned.metaPath, jsonFile(planned.meta));
      plannedMetas.set(planned.metaPath, planned.meta);
    }
  const currentMetas = metas.map((meta) =>
    plannedMetas.has(meta.path)
      ? { path: meta.path, value: plannedMetas.get(meta.path) }
      : meta,
  );

  const validators = {
    avatar_effect: (effect) => validate(effect.definition),
    particle_effect: validateParticle,
    scene_effect: validateScene,
  };
  for (const item of effectItems) {
    const kind = kindOf(item);
    const { folder, files, descriptorPath, original, contentId } =
      targets.get(item);
    const fail = (message) => {
      throw new EffectPromoteError(`${item.stem}: ${message}`);
    };

    if (item.mode === "delete") {
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
        fail(`still used by ${dependents.join(", ")}; re-point them first.`);
      for (const file of files) deletes.add(`${folder}/${file}`);
      const rule = ruleIndex(particleRule(item.stem));
      if (kind === "particle_effect" && rule >= 0)
        inventory.rules.splice(rule, 1);
      continue;
    }

    const { effect } = item;
    if ((effect.dependencies ?? []).length || effect.definition?.soundAlias)
      fail(
        "the source has a sound or other dependencies; Included effects are promoted without them.",
      );
    try {
      await validators[kind](effect);
    } catch (error) {
      fail(error.message);
    }
    const sound =
      kind === "avatar_effect" ? licensedSound(item, original) : null;
    const planned = EFFECT_PLANNERS[kind](item, {
      original,
      contentId,
      fail,
      sound,
    });
    for (const { file, issues } of await sourceAssets(effect)) {
      const fails = issues.filter((issue) => issue.level === "FAIL");
      if (fails.length)
        fail(
          `${path.basename(file)} fails the art check: ${fails.map((issue) => issue.message).join("; ")}`,
        );
    }
    writes.set(descriptorPath, jsonFile(planned.descriptor));
    for (const { name, file } of planned.files) {
      const bytes = await readFile(file);
      writes.set(`${folder}/${name}`, bytes);
      const origin = thirdPartyOrigin(bytes);
      if (origin) carried.set(`${folder}/${name}`, origin);
    }
    for (const file of files ?? [])
      if (!writes.has(`${folder}/${file}`)) deletes.add(`${folder}/${file}`);
    if (kind === "particle_effect" && ruleIndex(particleRule(item.stem)) < 0) {
      inventory.rules.splice(ruleIndex(EFFECT_KINDS.particle_effect.rule), 0, {
        glob: particleRule(item.stem),
        creator,
        provenance:
          "The owner confirms they created the particle-effect assets.",
        license_id: licenseId,
        redistribution_review: redistributionReview,
      });
      ruleReasons.set(particleRule(item.stem), "owner-authored");
    }
  }

  // Reused third-party art keeps the licence rule of the file it repeats, in
  // a rule for the copy ahead of the effect's own; rules for files this run
  // deletes or rewrites go.
  const inIncluded = (relative) => relative.replace(/^content\/included\//, "");
  const effectRoots = Object.values(EFFECT_KINDS).map(({ root }) => `${root}/`);
  const touched = new Set(
    [...deletes, ...writes.keys()]
      .filter((relative) =>
        effectRoots.some((root) => relative.startsWith(root)),
      )
      .map((relative) => inIncluded(relative)),
  );
  inventory.rules = inventory.rules.filter((rule) => !touched.has(rule.glob));
  for (const [relative, origin] of carried) {
    const terms = originalRules.find((rule) =>
      globMatches(rule.glob, inIncluded(origin.path)),
    );
    if (!terms)
      throw new EffectPromoteError(
        `${EFFECT_PROMOTE_PATHS.inventory}: no rule covers ${origin.path}, which ${relative} repeats.`,
      );
    const copy = inIncluded(relative);
    const at = inventory.rules.findIndex((rule) =>
      globMatches(rule.glob, copy),
    );
    if (at >= 0 && inventory.rules[at] === terms) continue;
    inventory.rules.splice(at < 0 ? inventory.rules.length : at, 0, {
      ...terms,
      glob: copy,
    });
    ruleReasons.set(copy, `carried from ${origin.path}`);
  }
  if (JSON.stringify(inventory.rules) !== JSON.stringify(originalRules)) {
    const before = new Map(originalRules.map((rule) => [rule.glob, rule]));
    const after = new Map(inventory.rules.map((rule) => [rule.glob, rule]));
    writes.set(EFFECT_PROMOTE_PATHS.inventory, jsonFile(inventory));
    notes.set(EFFECT_PROMOTE_PATHS.inventory, [
      ...[...after]
        .filter(
          ([glob, rule]) =>
            JSON.stringify(rule) !== JSON.stringify(before.get(glob)),
        )
        .map(([glob]) => `rule ${glob} (${ruleReasons.get(glob)})`),
      ...[...before.keys()]
        .filter((glob) => !after.has(glob))
        .map((glob) => `no rule ${glob}`),
    ]);
  }

  // One record per written effect file, in the existing effect files' form.
  const written = [...writes.keys()].filter((relative) =>
    effectRoots.some((root) => relative.startsWith(root)),
  );
  const superseded = sourceReview.files.filter(
    (entry) => deletes.has(entry.path) || written.includes(entry.path),
  );
  sourceReview.files = sourceReview.files.filter(
    (entry) => !superseded.includes(entry),
  );
  for (const relative of written)
    sourceReview.files.push({
      path: relative,
      ...(carried.get(relative)?.record ?? recordFields),
    });
  sourceReview.files.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  writes.set(EFFECT_PROMOTE_PATHS.sourceReview, jsonFile(sourceReview));
  notes.set(EFFECT_PROMOTE_PATHS.sourceReview, [
    ...written.map((file) =>
      carried.has(file)
        ? `record for ${file} carried from ${carried.get(file).path}`
        : `record for ${file}`,
    ),
    ...superseded
      .filter((entry) => deletes.has(entry.path))
      .map((entry) => `no record for ${entry.path}`),
    ...superseded
      .filter(
        (entry) =>
          Array.isArray(entry.evidence) &&
          entry.evidence.length &&
          !carried.has(entry.path),
      )
      .map(
        (entry) =>
          `${entry.path} had a third-party record (${entry.evidence.join(", ")}); update that evidence`,
      ),
  ]);

  const changes = [];
  for (const [relative, content] of writes) {
    const current = repo.readBytes(relative);
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (current && current.equals(next)) continue;
    changes.push({
      path: relative,
      action: current ? "update" : "create",
      content,
      ...(notes.has(relative) ? { notes: notes.get(relative) } : {}),
    });
  }
  for (const relative of deletes)
    changes.push({ path: relative, action: "delete" });
  return changes;
}

/**
 * How each effect kind is written: given an add or replace item (with its
 * resolved `effect`), the Included descriptor and the source files to copy
 * into the folder as `{ name, file }`. Each refuses file names that are
 * unsafe as Included paths.
 */
const EFFECT_PLANNERS = {
  avatar_effect(item, { original, contentId, fail, sound }) {
    const { effect } = item;
    const images = [
      { name: effect.definition.art?.image, file: effect.imagePath },
      ...(effect.otherImagePath
        ? [
            {
              name: effect.definition.art.otherEyeImage,
              file: effect.otherImagePath,
            },
          ]
        : []),
    ];
    for (const image of images)
      if (!isPlainFileName(image.name))
        fail(
          `image "${image.name}" must be a plain file name in the effect folder.`,
        );
    if (images.length === 2 && images[0].name === images[1].name)
      fail("art.image and art.otherEyeImage must be different files.");
    if (images.some((image) => image.name === `${item.stem}.json`))
      fail("an image cannot be named like the descriptor.");
    const files = images.map((image) => ({ path: image.name, role: "image" }));
    const dependencies = sound ? [sound] : [];
    const definition = sound
      ? { ...effect.definition, soundAlias: sound.alias }
      : effect.definition;
    return {
      descriptor: original
        ? {
            ...original,
            description: item.description ?? original.description,
            dependencies,
            definition,
            files,
          }
        : {
            schema_version: 1,
            content_type: "avatar_effect",
            content_id: contentId,
            version: 1,
            name: item.name ?? effect.name,
            description: item.description ?? effect.description,
            dependencies,
            definition,
            files,
          },
      files: images,
    };
  },

  particle_effect(item, { original, contentId, fail }) {
    const { effect } = item;
    const textures = effect.texturePaths.map((file) => ({
      name: path.relative(effect.folder, file).split(path.sep).join("/"),
      file,
    }));
    for (const { name } of textures) {
      if (!TEXTURE_FILE.test(name))
        fail(
          `texture "${name}" must be a file name or one folder deep (such as textures/<name>.png).`,
        );
      if (name === PARTICLE_MANIFEST || name === `${item.stem}.json`)
        fail(
          `texture "${name}" cannot be named like the descriptor or manifest.`,
        );
    }
    if (new Set(textures.map(({ name }) => name)).size !== textures.length)
      fail("the source lists a texture twice.");
    const name = original?.name ?? item.name ?? effect.name;
    const description =
      item.description ?? original?.description ?? effect.description;
    // The runtime label and description follow the Library's, as the
    // creator's Save writes them.
    const runtimeDefaults = {
      schema_version: 1,
      runtime_id: original?.runtime_defaults?.runtime_id ?? item.stem,
      slots: { particle_vfx: { ...effect.defaults, label: name, description } },
    };
    const files = [
      { path: PARTICLE_MANIFEST, role: "manifest" },
      ...textures.map((texture) => ({ path: texture.name, role: "texture" })),
    ];
    return {
      descriptor: original
        ? { ...original, description, runtime_defaults: runtimeDefaults, files }
        : {
            schema_version: 1,
            content_type: "particle_effect",
            content_id: contentId,
            version: 1,
            name,
            description,
            runtime_defaults: runtimeDefaults,
            files,
          },
      files: [
        { name: PARTICLE_MANIFEST, file: effect.manifestPath },
        ...textures,
      ],
    };
  },

  scene_effect(item, { original, contentId, fail }) {
    const { effect } = item;
    const images = Object.entries(effect.imagePaths).map(([name, file]) => ({
      name,
      file,
    }));
    for (const image of images) {
      if (!isPlainFileName(image.name))
        fail(
          `image "${image.name}" must be a plain file name in the effect folder.`,
        );
      if (!image.name.toLowerCase().endsWith(".png"))
        fail(
          `${image.name}: Scene art is promoted as PNG (owner-authored art under ${EFFECT_KINDS.scene_effect.rule}).`,
        );
      if (image.name === `${item.stem}.json`)
        fail("an image cannot be named like the descriptor.");
    }
    const files = images.map((image) => ({ path: image.name, role: "image" }));
    return {
      descriptor: original
        ? {
            ...original,
            description: item.description ?? original.description,
            dependencies: [],
            definition: effect.definition,
            files,
          }
        : {
            schema_version: 1,
            content_type: "scene_effect",
            content_id: contentId,
            version: 1,
            name: item.name ?? effect.name,
            description: item.description ?? effect.description,
            dependencies: [],
            definition: effect.definition,
            files,
          },
      files: images,
    };
  },
};

/** Whether a clip field holds anything (an empty object or list does not). */
function isSet(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * Check one Reaction or Gesture replace and return its clip (with the
 * Included clip file's path and text) and its meta as it will be.
 */
function planAction(
  item,
  kind,
  { repo, validateClip, includedTypes, promotedRefs },
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
  for (const key of KEPT_CLIP_FIELDS)
    if (JSON.stringify(clip[key]) !== JSON.stringify(originalClip[key]))
      fail(
        `a replace keeps the Included clip's ${key} (${JSON.stringify(originalClip[key]) ?? "unset"}).`,
      );
  if (kind === "reaction")
    for (const field of REACTION_BODY_FIELDS)
      if (isSet(clip[field]))
        fail(`Reactions are expression-only; the clip sets ${field}.`);

  let dependencies;
  try {
    dependencies = includedActionDependencies(
      project.dependencies,
      clip.events,
      { includedTypes, promotedRefs },
    );
  } catch (error) {
    fail(error.message);
  }

  return {
    clip,
    clipPath,
    clipText,
    metaPath,
    meta: { ...original, dependencies },
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
        return readdirSync(path.join(root, relative), {
          recursive: true,
          withFileTypes: true,
        })
          .filter((entry) => entry.isFile())
          .map((entry) =>
            path
              .relative(
                path.join(root, relative),
                path.join(entry.parentPath, entry.name),
              )
              .split(path.sep)
              .join("/"),
          )
          .sort();
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    identicalIncludedFiles(bytes) {
      const matches = [];
      const walk = (relative) => {
        for (const entry of readdirSync(path.join(root, relative), {
          withFileTypes: true,
        })) {
          const child = `${relative}/${entry.name}`;
          if (entry.isDirectory()) walk(child);
          else if (
            entry.isFile() &&
            statSync(path.join(root, child)).size === bytes.length &&
            readFileSync(path.join(root, child)).equals(bytes)
          )
            matches.push(child);
        }
      };
      walk("content/included");
      return matches.sort();
    },
    includedMetas: () => listIncludedMetas(root, { readFileSync, readdirSync }),
  };
}

/**
 * Apply planned changes under `root`. Deletes run deepest first and remove
 * each folder they empty, so a deleted effect leaves no empty folders.
 */
export async function applyEffectPromotion(root, changes) {
  const depth = (change) => change.path.split("/").length;
  const deletes = changes
    .filter((change) => change.action === "delete")
    .sort((a, b) => depth(b) - depth(a));
  for (const change of changes)
    if (change.action !== "delete") {
      const target = path.join(root, change.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, change.content);
    }
  for (const change of deletes) {
    const target = path.join(root, change.path);
    await rm(target, { force: true });
    await rmdir(path.dirname(target)).catch(() => {});
  }
}
