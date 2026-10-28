import { readFile } from "node:fs/promises";
import path from "node:path";

import { BUDGETS, checkImage } from "./effect-assets.mjs";
import {
  AVATARS,
  DEFAULT_THRESHOLD,
  DEFAULT_TILE,
  VIEW_NAMES,
  VISIBLE_SHARE,
  artBaselineEffect,
  avatarFileUrl,
  captureStage,
  countChangedPixels,
  pageEffect,
  pageSources,
  rawRgba,
  sourceRoots,
  withRendererPage,
} from "./effect-render.mjs";
import {
  INCLUDED_CONTENT_ROOT,
  sceneDefinitionImageUses,
} from "./effect-render-sources.mjs";

/**
 * `pnpm -s effects check`: the checks an Avatar, Particle or Scene Effect
 * source must pass before it is saved or reviewed.
 *
 * - **Art:** every image passes `effects:assets check` against its budget: an
 *   Avatar Effect's attachment budget (a flipbook sheet uses the flipbook
 *   budget), `particle-texture` or `particle-sheet` for a Particle texture
 *   (by whether an emitter tiles it), `scene-sticker` for a Scene PNG.
 * - **Definition:** it parses as the runtime parses it, with the offending
 *   field named.
 * - **Particles:** the estimated peak particle count fits the effect's
 *   declared budget and the runtime's 512-particle limit.
 * - **Attachment:** applied on both Included Avatars, the effect is active and
 *   no controller reports a warning (a missing face part, bone or texture).
 * - **Visible art:** at each time and view, the frame is rendered with the
 *   effect and against a baseline: for face effects the same effect with
 *   fully transparent stand-in images (so face options such as closed eyes
 *   are in both), otherwise the bare Avatar. Scene layers are captured from
 *   the page as the chat draws them. Somewhere on each Avatar the effect must
 *   change at least `VISIBLE_SHARE` of a tile.
 * - **Pose:** with a Gesture clip (`--with-clip`), the baseline and effect
 *   frames both sample it at each time, so art on a bone the Gesture moves
 *   (a hand, say) is checked where the Gesture puts it rather than arms down.
 */

export const DEFAULT_CHECK_TIMES = [0.25, 1];

/** Particles a Particle Effect may declare, as the runtime caps them. */
export const RUNTIME_PARTICLE_LIMIT = 512;

/** The `effects:assets` budget an Avatar Effect's images are held to. */
export function budgetForDefinition(definition) {
  if (definition?.art?.flipbook)
    return { name: "flipbook", ...BUDGETS.flipbook };
  const kind = definition?.attachment?.kind;
  const name =
    {
      face_landmark: "landmark",
      face_surface: "surface",
      body: "body",
      sticker: "sticker",
      silhouette: "silhouette",
    }[kind] ?? "landmark";
  return { name, ...BUDGETS[name] };
}

const shortAvatar = (id) => id.replace("AvatarSample_", "");

/**
 * Each texture URL of a Quarks manifest, mapped to `particle-sheet` when an
 * emitter that draws it uses more than one tile, else `particle-texture`.
 */
export function particleTextureBudgets(manifest) {
  const byUuid = (key) =>
    new Map(
      (Array.isArray(manifest?.[key]) ? manifest[key] : []).map((item) => [
        item?.uuid,
        item,
      ]),
    );
  const materials = byUuid("materials");
  const textures = byUuid("textures");
  const images = byUuid("images");
  const budgets = new Map();
  for (const image of images.values())
    if (typeof image?.url === "string")
      budgets.set(image.url, "particle-texture");
  const pending = [manifest?.object];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node.children)) pending.push(...node.children);
    const ps = node.ps;
    if (!ps || (ps.uTileCount ?? 1) * (ps.vTileCount ?? 1) <= 1) continue;
    const texture = textures.get(materials.get(ps.material)?.map);
    const url = images.get(texture?.image)?.url;
    if (typeof url === "string") budgets.set(url, "particle-sheet");
  }
  return budgets;
}

/** Check each file against its budget; an unreadable file is a FAIL. */
async function checkFiles(entries) {
  const assets = [];
  for (const { file, budget } of entries) {
    try {
      const { issues } = await checkImage(file, { budget });
      assets.push({ file, budget: budget.name, issues });
    } catch (error) {
      assets.push({
        file,
        issues: [{ level: "FAIL", code: "unreadable", message: error.message }],
      });
    }
  }
  return assets;
}

/** Art checks for one source of any kind. */
export async function sourceAssets(effect) {
  if (effect.kind === "particle") {
    const manifest = JSON.parse(await readFile(effect.manifestPath, "utf8"));
    const budgets = particleTextureBudgets(manifest);
    const folder = path.dirname(effect.manifestPath);
    return checkFiles(
      effect.texturePaths.map((file) => {
        const name =
          budgets.get(path.relative(folder, file).split(path.sep).join("/")) ??
          "particle-texture";
        return { file, budget: { name, ...BUDGETS[name] } };
      }),
    );
  }
  if (effect.kind === "scene") {
    // A tile is held to the tile budget, every other image to the sticker's.
    const tiles = new Set(
      sceneDefinitionImageUses(effect.definition)
        .filter((use) => use.layer === "tile")
        .map((use) => use.image),
    );
    return checkFiles(
      Object.entries(effect.imagePaths)
        // The restricted SVG art is checked by the backend, not the scripts.
        .filter(([, file]) => file.toLowerCase().endsWith(".png"))
        .map(([image, file]) => {
          const name = tiles.has(image) ? "scene-tile" : "scene-sticker";
          return { file, budget: { name, ...BUDGETS[name] } };
        }),
    );
  }
  const budget = budgetForDefinition(effect.definition);
  return checkFiles(
    [effect.imagePath, effect.otherImagePath]
      .filter(Boolean)
      .map((file) => ({ file, budget })),
  );
}

/** Where the creator's built-in textures (`textures/<file>`) are bundled from. */
const BUILT_IN_TEXTURE_ROOT = path.join(
  INCLUDED_CONTENT_ROOT,
  "vfx/particle/particle-vfx",
);

/**
 * The effect's own textures that are named like one of the creator's
 * built-in textures (`builtInReferences`, such as `textures/heart.png`) but
 * hold other bytes. The creator draws and saves its built-in art for such a
 * reference, so the effect would be saved with art it was not reviewed with.
 */
export async function builtInTextureCollisions(effect, builtInReferences) {
  const collisions = [];
  for (const file of effect.texturePaths) {
    const reference = path
      .relative(effect.folder, file)
      .split(path.sep)
      .join("/");
    if (!builtInReferences.has(reference)) continue;
    const builtIn = await readFile(
      path.join(BUILT_IN_TEXTURE_ROOT, reference),
    ).catch(() => null);
    if (!builtIn?.equals(await readFile(file))) collisions.push(reference);
  }
  return collisions;
}

const englishCatalogs = new WeakMap();

/**
 * Load the app's English catalogs into a Vite SSR loader once. The creators'
 * modules word their messages through react-i18next's shared instance, which
 * only the app's entry point otherwise creates.
 */
export function loadEnglishCatalogs(server) {
  if (!englishCatalogs.has(server))
    englishCatalogs.set(
      server,
      server
        .ssrLoadModule("/src/i18n/web-i18n.ts")
        .then(({ createWebI18n }) => createWebI18n("en")),
    );
  return englishCatalogs.get(server);
}

/**
 * Report lines on a Particle Effect as the creator's Save would judge it:
 * the content readiness errors (limits, and image references that must name
 * a listed texture) and Save's conservative estimate of particles alive at once
 * against the declared budget and the runtime limit.
 */
export async function particleSourceLines(effect, server) {
  await loadEnglishCatalogs(server);
  const manifest = JSON.parse(await readFile(effect.manifestPath, "utf8"));
  const editor = await server.ssrLoadModule(
    "/src/lib/avatar/particle-vfx/editor/index.ts",
  );
  const { parseParticleVFXRuntimeConfig } = await server.ssrLoadModule(
    "/src/lib/avatar/particle-vfx/runtimeConfig.ts",
  );
  const draft = editor.createParticleVFXEditorDraftFromImport(
    manifest,
    parseParticleVFXRuntimeConfig(effect.defaults),
  );
  const folder = path.dirname(effect.manifestPath);
  const listed = new Set(
    effect.texturePaths.map((file) =>
      path.relative(folder, file).split(path.sep).join("/"),
    ),
  );
  const { issues } = editor.validateParticleVFXContentReadiness(draft, {
    resolvableTextureReferences: listed,
  });
  const lines = issues
    // The estimate line below states the budget check with its numbers.
    .filter(
      (issue) =>
        issue.severity === "error" && issue.code !== "particle-budget-exceeded",
    )
    .map((issue) => ({
      level: "FAIL",
      message: `particles: ${issue.message} (${issue.target})`,
    }));
  for (const reference of await builtInTextureCollisions(
    effect,
    new Set(
      editor.PARTICLE_VFX_EDITOR_TEXTURES.map((texture) => texture.relativeUrl),
    ),
  ))
    lines.push({
      level: "FAIL",
      message: `particles: ${reference} is named like a built-in creator texture, so Save would keep the built-in art instead; rename the file and its image URL`,
    });
  const estimate = editor.estimateParticleVFXParticles(draft.quarksJson);
  // The runtime caps the budget at the limit; report what the folder declares.
  const budget = draft.catalog.performanceBudget.maxParticles;
  const raw = effect.defaults.max_particles;
  const declared = Number.isInteger(raw) && raw > 0 ? raw : budget;
  lines.push({
    level:
      estimate > budget || declared > RUNTIME_PARTICLE_LIMIT ? "FAIL" : "PASS",
    message: `particles: Save's estimate is ${Number.isFinite(estimate) ? `up to ${estimate}` : "unbounded"} at once (declared budget ${declared}, runtime limit ${RUNTIME_PARTICLE_LIMIT})`,
  });
  return lines;
}

/**
 * Report lines on a Scene Effect's definition against the shared Scene limits
 * the creator and the backend apply at Save, so a folder over them fails here
 * rather than at `effects save`.
 */
export async function sceneLimitLines(effect, server) {
  const { sceneDefinitionLimitIssues } = await server.ssrLoadModule(
    "/src/lib/scene-vfx/limits.ts",
  );
  const issues = sceneDefinitionLimitIssues(effect.definition);
  return issues.length
    ? issues.map((issue) => ({
        level: "FAIL",
        message: `scene: ${issue.message}`,
      }))
    : [{ level: "PASS", message: "scene: within the shared Scene limits" }];
}

/**
 * Report lines on a Scene Effect's image list: every image an item shows
 * must be listed in the descriptor, and a listed image no item shows is
 * carried for nothing.
 */
export function sceneImageLines(effect) {
  const listed = new Set(effect.listedImages);
  const shown = Object.keys(effect.imagePaths);
  const lines = [
    ...shown
      .filter((image) => !listed.has(image))
      .map((image) => ({
        level: "FAIL",
        message: `scene: ${image} is shown by an item but not listed as an image file`,
      })),
    ...[...listed]
      .filter((image) => !shown.includes(image))
      .map((image) => ({
        level: "WARN",
        message: `scene: ${image} is listed but no item shows it`,
      })),
  ];
  return lines.length || !shown.length
    ? lines
    : [
        {
          level: "PASS",
          message: `scene: ${shown.length} image${shown.length === 1 ? "" : "s"} shown and listed`,
        },
      ];
}

/** Pixels of each tile in `applied` that differ from `baseline`. */
async function differingPixels(applied, baseline, threshold) {
  const counts = [];
  for (const [time, views] of applied.entries()) {
    const row = [];
    for (const [view, png] of views.entries()) {
      const [after, before] = await Promise.all([
        rawRgba(png),
        rawRgba(baseline[time][view]),
      ]);
      row.push(countChangedPixels(after, before, { threshold }).changed);
    }
    counts.push(row);
  }
  return counts;
}

/**
 * Turn one effect's results into report lines `{ level, message }`.
 * `assets` are `{ file, budget, issues }` per image (a clean one reports a
 * PASS line naming its budget); `page` holds the parse error,
 * or each Avatar's diagnostics and differing pixels per frame.
 * `suggestClip` adds a `--with-clip` hint to "no visible art" (for
 * bone-attached art checked without a Gesture); poses a `--with-clip`
 * Gesture names that the app catalog lacks are a WARN.
 */
export function summarizeCheck({
  assets,
  page,
  times,
  views,
  tile,
  suggestClip = false,
}) {
  const lines = [];
  for (const { file, budget, issues } of assets) {
    for (const issue of issues)
      lines.push({
        level: issue.level,
        message: `art ${path.basename(file)}: ${issue.message} [${issue.code}]`,
      });
    if (!issues.length)
      lines.push({
        level: "PASS",
        message: `art ${path.basename(file)}: within the ${budget} budget`,
      });
  }
  if (page.parseError) {
    lines.push({ level: "FAIL", message: `definition: ${page.parseError}` });
    return lines;
  }
  const floor = Math.ceil(tile.width * tile.height * VISIBLE_SHARE);
  for (const avatar of page.avatars) {
    const label = shortAvatar(avatar.id);
    for (const warning of avatar.warnings)
      lines.push({ level: "FAIL", message: `${label}: ${warning}` });
    if (!avatar.applied || avatar.activeEffectIds.length === 0) {
      lines.push({
        level: "FAIL",
        message: `${label}: the effect is not active`,
      });
      continue;
    }
    const frames = avatar.differingPixels.flatMap((row, timeIndex) =>
      row.map((pixels, viewIndex) => ({
        pixels,
        time: times[timeIndex],
        view: views[viewIndex],
      })),
    );
    const visible = frames.filter((frame) => frame.pixels >= floor);
    const most = frames.reduce((best, frame) =>
      frame.pixels > best.pixels ? frame : best,
    );
    if (!visible.length)
      lines.push({
        level: "FAIL",
        message: `${label}: no visible art (at most ${most.pixels} px changed; ${floor} needed; if it appears later, try --times${suggestClip ? "; on a bone a Gesture moves, check it in that pose with --with-clip <gesture>" : ""})`,
      });
    else {
      const hidden = times.filter(
        (time) => !visible.some((frame) => frame.time === time),
      );
      const missed = frames
        .filter((frame) => frame.pixels < floor)
        .map((frame) => `${frame.view} ${frame.time}s`);
      lines.push({
        level: hidden.length ? "WARN" : "PASS",
        message:
          `${label}: visible in ${visible.length} of ${frames.length} frames, up to ${most.pixels} px (${most.view}, ${most.time}s)` +
          (hidden.length
            ? `; nothing shows at ${hidden.join("s, ")}s`
            : missed.length && missed.length <= 4
              ? ` (not in ${missed.join(", ")})`
              : ""),
      });
    }
  }
  // As effects:render reports them: a pose the clip names that the app
  // catalog lacks renders as the base pose, so that frame is not the
  // Gesture's pose.
  const missingPoses = [
    ...new Set(page.avatars.flatMap((avatar) => avatar.missingPoseRefs ?? [])),
  ];
  if (missingPoses.length)
    lines.push({
      level: "WARN",
      message: `clip poses not in the app catalog rendered as the base pose: ${missingPoses.join(", ")}`,
    });
  return lines;
}

/**
 * Check Avatar, Particle and Scene effect sources (as
 * `resolveAnyEffectSource` returns them). `clip` is a Gesture clip
 * (`resolveClipSource`'s `clip`) that poses both Avatars at each time, or
 * null for the rest pose. Returns one `{ stem, lines }` per effect; every
 * effect is attempted.
 */
export async function checkEffects({
  effects,
  times = DEFAULT_CHECK_TIMES,
  views = VIEW_NAMES,
  tile = DEFAULT_TILE,
  threshold = DEFAULT_THRESHOLD,
  localContent = null,
  clip = null,
}) {
  const assetResults = [];
  for (const effect of effects) assetResults.push(await sourceAssets(effect));
  return withRendererPage(
    { localContent, extraRoots: await sourceRoots(effects) },
    async ({ page, fsUrl, imageUrl, server }) => {
      const avatars = AVATARS.map((id) => ({
        id,
        url: avatarFileUrl(fsUrl, id),
      }));
      const results = [];
      for (const [index, effect] of effects.entries()) {
        let pageResult;
        const extraLines = [];
        try {
          if (effect.kind === "particle")
            extraLines.push(
              ...(await particleSourceLines(effect, server).catch((error) => [
                { level: "FAIL", message: `particles: ${error.message}` },
              ])),
            );
          if (effect.kind === "scene")
            extraLines.push(
              ...sceneImageLines(effect),
              ...(await sceneLimitLines(effect, server)),
            );
          const applied = await pageSources([effect], { fsUrl, imageUrl });
          // Face effects compare against transparent stand-ins; other
          // attachments, Particle and Scene Effects against the bare Avatar.
          const standIn = await artBaselineEffect(effect, applied.effects[0]);
          const baselineEffects = standIn ? [standIn] : [];
          // A --with-clip Gesture poses both captures; its effect events
          // are not played (no clip media), so only the effect differs.
          const common = {
            tile,
            expression: null,
            clip,
            clipMedia: null,
          };
          const after = await captureStage(page, {
            request: { ...common, ...applied },
            avatars,
            times,
            views,
          });
          if (after.parseError) pageResult = { parseError: after.parseError };
          else {
            const before = await captureStage(page, {
              request: {
                ...common,
                effects: baselineEffects,
                particles: [],
                scenes: [],
              },
              avatars,
              times,
              views,
            });
            const checked = [];
            for (const [avatarIndex, avatar] of after.avatars.entries()) {
              const { frames, ...diagnostics } = avatar;
              checked.push({
                ...diagnostics,
                differingPixels: await differingPixels(
                  frames,
                  before.avatars[avatarIndex].frames,
                  threshold,
                ),
              });
            }
            pageResult = { parseError: null, avatars: checked };
          }
        } catch (error) {
          pageResult = {
            parseError: null,
            avatars: [],
            renderError: error instanceof Error ? error.message : String(error),
          };
        }
        const lines = [
          ...summarizeCheck({
            assets: assetResults[index],
            page: pageResult,
            times,
            views,
            tile,
            suggestClip:
              !clip && effect.definition?.attachment?.kind === "body",
          }),
          ...extraLines,
        ];
        if (pageResult.renderError)
          lines.push({
            level: "FAIL",
            message: `render: ${pageResult.renderError.split("\n")[0]}`,
          });
        results.push({ stem: effect.stem, lines });
      }
      return results;
    },
  );
}
