import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AVATAR_EFFECT_TEMPLATES } from "../src/lib/effects/effectTemplates.ts";
import {
  EffectRenderFailure,
  renderEffectThumbnails,
} from "./effect-render.mjs";
import {
  EffectSourceError,
  resolveEffectSource,
} from "./effect-render-sources.mjs";

/**
 * Regenerate the Avatar FX template thumbnails shown by the Effects template
 * picker:
 *
 *   pnpm -s effects:thumbnails [template-id...]
 *
 * Each template in `src/lib/effects/effectTemplates.ts` is rendered on Annie
 * with the `effects:render --thumbnail` renderer (portrait head framing, live
 * expression, 1 s after applying) into
 * `src/assets/effect-templates/<id>.webp`. A full run also removes thumbnails
 * whose template no longer exists. Renders are deterministic, so unchanged
 * effects reproduce identical files.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
export const THUMBNAIL_DIR = path.join(webRoot, "src/assets/effect-templates");
/** Edge in pixels; cards show them at up to about 160 CSS px. */
export const THUMBNAIL_SIZE = 320;
/** Seconds after applying, so motion and fades have settled. */
export const THUMBNAIL_TIME = 1;

/** The templates a run renders: all of them, or the named IDs. */
export function selectTemplates(ids) {
  if (ids.length === 0) return [...AVATAR_EFFECT_TEMPLATES];
  return ids.map((id) => {
    const template = AVATAR_EFFECT_TEMPLATES.find((entry) => entry.id === id);
    if (!template)
      throw new EffectSourceError(`Unknown Avatar FX template ${id}.`);
    return template;
  });
}

async function removeStaleThumbnails() {
  const known = new Set(AVATAR_EFFECT_TEMPLATES.map(({ id }) => `${id}.webp`));
  const removed = [];
  for (const name of await readdir(THUMBNAIL_DIR).catch(() => [])) {
    if (name.endsWith(".webp") && !known.has(name)) {
      await rm(path.join(THUMBNAIL_DIR, name));
      removed.push(name);
    }
  }
  return removed;
}

async function main(argv) {
  if (argv.includes("--help") || argv.some((arg) => arg.startsWith("--"))) {
    console.log("Usage: pnpm -s effects:thumbnails [template-id...]");
    return argv.includes("--help") ? 0 : 2;
  }
  try {
    const templates = selectTemplates(argv);
    const jobs = [];
    for (const template of templates)
      jobs.push({
        effect: await resolveEffectSource(
          `library:included/${template.contentId}`,
          {
            cwd: webRoot,
            localContent: null,
          },
        ),
        outFile: path.join(THUMBNAIL_DIR, `${template.id}.webp`),
      });
    await renderEffectThumbnails({
      jobs,
      time: THUMBNAIL_TIME,
      size: THUMBNAIL_SIZE,
      onResult: (result) =>
        console.log(
          result.failures.length
            ? `FAILED ${result.stem}: ${result.failures.join("; ")}`
            : `Wrote ${path.relative(webRoot, result.outFile)}`,
        ),
    });
    if (argv.length === 0)
      for (const name of await removeStaleThumbnails())
        console.log(`Removed stale ${name}`);
    return 0;
  } catch (error) {
    if (error instanceof EffectSourceError) {
      console.log(error.message);
      return 2;
    }
    if (error instanceof EffectRenderFailure) {
      const failed = error.results.filter((result) => result.failures.length);
      console.log(`${failed.length} of ${error.results.length} failed.`);
      return 1;
    }
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
