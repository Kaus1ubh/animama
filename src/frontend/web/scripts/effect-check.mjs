import path from "node:path";
import sharp from "sharp";

import { BUDGETS, checkImage, readMetadata } from "./effect-assets.mjs";
import {
  AVATARS,
  DEFAULT_THRESHOLD,
  DEFAULT_TILE,
  VIEW_NAMES,
  avatarFileUrl,
  pageEffect,
  withRendererPage,
} from "./effect-render.mjs";

/**
 * `pnpm -s effects check`: the checks an Avatar Effect source must pass before
 * it is saved or reviewed.
 *
 * - **Art:** every image passes `effects:assets check` against the budget of
 *   its attachment (a flipbook sheet uses the flipbook budget).
 * - **Definition:** the `/2` definition parses as the runtime parses it,
 *   with the offending field named.
 * - **Attachment:** applied on both Included Avatars, the effect is active and
 *   the controller reports no warning (a missing face part or bone warns).
 * - **Visible art:** at each time and view, the frame is rendered with the
 *   effect and against a baseline: for face effects the same effect with
 *   fully transparent stand-in images (so face options such as closed eyes
 *   are in both), otherwise the bare Avatar. Somewhere on each Avatar the
 *   effect must change at least `VISIBLE_SHARE` of a tile.
 */

export const DEFAULT_CHECK_TIMES = [0.25, 1];
/** Share of a tile's pixels the effect must change on each Avatar. */
export const VISIBLE_SHARE = 0.001;

/** The `effects:assets` budget an effect's images are held to. */
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

/** A fully transparent PNG data URL the size of `file`. */
async function transparentStandIn(file) {
  const { width, height } = await readMetadata(file);
  const png = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Turn one effect's results into report lines `{ level, message }`.
 * `assets` are `{ file, issues }` per image; `page` is the renderer's
 * `checkEffect` result.
 */
export function summarizeCheck({ assets, page, times, views, tile }) {
  const lines = [];
  for (const { file, issues } of assets)
    for (const issue of issues)
      lines.push({
        level: issue.level,
        message: `art ${path.basename(file)}: ${issue.message} [${issue.code}]`,
      });
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
        message: `${label}: no visible art (at most ${most.pixels} px changed; ${floor} needed; if it appears later, try --times)`,
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
  return lines;
}

/**
 * Check effect sources (as `resolveEffectSource` returns them). Returns one
 * `{ stem, lines }` per effect; every effect is attempted.
 */
export async function checkEffects({
  effects,
  times = DEFAULT_CHECK_TIMES,
  views = VIEW_NAMES,
  tile = DEFAULT_TILE,
  threshold = DEFAULT_THRESHOLD,
  localContent = null,
}) {
  const assetResults = [];
  for (const effect of effects) {
    const budget = budgetForDefinition(effect.definition);
    const images = [effect.imagePath, effect.otherImagePath].filter(Boolean);
    const assets = [];
    for (const file of images) {
      try {
        const { issues } = await checkImage(file, { budget });
        assets.push({ file, issues });
      } catch (error) {
        assets.push({
          file,
          issues: [
            { level: "FAIL", code: "unreadable", message: error.message },
          ],
        });
      }
    }
    assetResults.push(assets);
  }
  return withRendererPage(
    { localContent },
    async ({ page, fsUrl, imageUrl }) => {
      const avatars = AVATARS.map((id) => ({
        id,
        url: avatarFileUrl(fsUrl, id),
      }));
      const results = [];
      for (const [index, effect] of effects.entries()) {
        let pageResult;
        try {
          const real = await pageEffect(effect, imageUrl);
          // Face effects change the face (closed eyes, cleanup) whatever the
          // art: compare against transparent stand-ins. Other attachments have
          // no face options, and a tinted silhouette fills even with
          // transparent art, so they compare against the bare Avatar.
          const kind = effect.definition?.attachment?.kind;
          const baselineEffects =
            kind === "face_landmark" || kind === "face_surface"
              ? [
                  {
                    ...real,
                    imageUrl: await transparentStandIn(effect.imagePath),
                    otherImageUrl: effect.otherImagePath
                      ? await transparentStandIn(effect.otherImagePath)
                      : null,
                  },
                ]
              : [];
          pageResult = await page.evaluate(
            (request) => window.checkEffect(request),
            {
              effects: [real],
              baselineEffects,
              avatars,
              times,
              tile,
              views,
              threshold,
              expression: null,
              clip: null,
            },
          );
        } catch (error) {
          pageResult = {
            parseError: null,
            avatars: [],
            renderError: error instanceof Error ? error.message : String(error),
          };
        }
        const lines = summarizeCheck({
          assets: assetResults[index],
          page: pageResult,
          times,
          views,
          tile,
        });
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
