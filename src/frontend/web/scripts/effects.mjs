import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CHECK_TIMES, checkEffects } from "./effect-check.mjs";
import { parseTimes } from "./effect-render.mjs";
import {
  EffectSourceError,
  resolveEffectSource,
} from "./effect-render-sources.mjs";
import {
  EffectPromoteError,
  applyEffectPromotion,
  parseEffectPromoteItems,
  planEffectPromotion,
  workingTreeRepo,
} from "./effect-promote.mjs";
import {
  EffectSaveError,
  importDocumentFor,
  parseEffectSaveItems,
  saveEffects,
} from "./effect-save.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
/** Local content of the sourced stack, for `library:local/...` sources. */
const defaultLocalContent = () =>
  process.env.ANIMAMA_LOCAL_CONTENT_HOST_PATH ?? null;

const VALUE_OPTIONS = new Set(["--times", "--local-content", "--url"]);
const FLAG_OPTIONS = new Set(["--help", "--dry-run"]);

/** Split a subcommand's argv into positional inputs, value options and flags. */
function parseArgs(argv) {
  const positional = [];
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (FLAG_OPTIONS.has(arg)) flags.add(arg);
    else if (VALUE_OPTIONS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new EffectSourceError(`${arg} needs a value.`);
      values[arg] = value;
      index += 1;
    } else if (arg.startsWith("--"))
      throw new EffectSourceError(`Unknown option ${arg}.`);
    else positional.push(arg);
  }
  return { positional, values, flags };
}

/**
 * Load a web module through Vite's SSR loader, so TypeScript and the `@`
 * alias resolve as in the app; `close` stops the loader.
 */
async function loadWebModule(file) {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    appType: "custom",
    cacheDir: path.join(webRoot, "node_modules/.vite-effects-cli"),
    define: {
      __ANIMAMA_DEV_BUILD__: "true",
      __ANIMAMA_APP_VERSION__: '"cli"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    return {
      module: await server.ssrLoadModule(file),
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

/**
 * Avatar Effect authoring commands, the effect counterpart of
 * `pnpm -s animation`:
 *
 *   pnpm -s effects check <source...> [--times 0.25,1] [--local-content <dir>]
 *   pnpm -s effects save <items.json> [--url <app origin>]
 *   pnpm -s effects promote <items.json> [--dry-run]
 *
 * A source is an effect folder, a descriptor `.json`, or
 * `library:[included/|local/]<stem|content_id|name>`, as for `effects:render`.
 */

const USAGE = [
  "Usage:",
  "  pnpm -s effects check <source...> [--times 0.25,1] [--local-content <dir>]",
  "  pnpm -s effects save <items.json> [--url <app origin>]",
  "  pnpm -s effects promote <items.json> [--dry-run]",
  "",
  "check: the art against its attachment's budget, the /2 definition, the",
  "attachment on both Included Avatars, and visible art (each Avatar must show",
  "the effect in some frame). Exits 1 when any effect has a FAIL.",
  "",
  'save: items.json is [{ "source": "<effect folder>", "name"?, "description"? }].',
  "Each source is saved as a Local Avatar Effect through the creator (a Local",
  "effect with the same name is revised), then reopened. The origin defaults",
  "to ANIMAMA_PUBLIC_ORIGIN (source the stack record), then http://localhost:8000.",
  "",
  "promote: only with the owner's explicit approval of each item, on a task",
  'branch and PR. Items: { "source", "stem", "mode": "add" | "replace",',
  '"name"?, "description"? } or { "stem", "mode": "delete" }. "source" is',
  "library:local/<name> (the sourced stack's Local content) or an effect folder.",
  "--dry-run lists every change and writes nothing.",
  "",
  "library:local/... sources read ANIMAMA_LOCAL_CONTENT_HOST_PATH unless",
  "--local-content is given.",
].join("\n");

async function runPromote(argv, cwd) {
  const { positional, values, flags } = parseArgs(argv);
  if (flags.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  if (positional.length !== 1)
    throw new EffectSourceError("promote takes one items.json file.");
  const itemsFile = path.resolve(cwd, positional[0]);
  const localContent = values["--local-content"]
    ? path.resolve(cwd, values["--local-content"])
    : defaultLocalContent();
  const validator = await loadWebModule("/src/lib/avatar/vfx/definition.ts");
  let changes;
  try {
    let raw;
    try {
      raw = JSON.parse(await readFile(itemsFile, "utf8"));
    } catch (error) {
      throw new EffectPromoteError(`${itemsFile}: ${error.message}`);
    }
    const items = parseEffectPromoteItems(raw, itemsFile);
    for (const item of items) {
      if (item.mode === "delete") continue;
      try {
        item.effect = await resolveEffectSource(item.source, {
          cwd: path.dirname(itemsFile),
          localContent,
        });
        const descriptor = JSON.parse(
          await readFile(item.effect.descriptorPath, "utf8"),
        );
        item.effect.dependencies = descriptor.dependencies ?? [];
      } catch (error) {
        throw new EffectPromoteError(`${item.stem}: ${error.message}`);
      }
    }
    changes = await planEffectPromotion(items, {
      repo: workingTreeRepo(repoRoot),
      validate: validator.module.validateAvatarEffectDefinition,
    });
  } catch (error) {
    if (!(error instanceof EffectPromoteError)) throw error;
    console.log(`Promotion refused: ${error.message}`);
    return 1;
  } finally {
    await validator.close();
  }
  const dryRun = flags.has("--dry-run");
  for (const { path: relative, action, notes = [] } of changes) {
    console.log(`${dryRun ? "Would " : ""}${action} ${relative}`);
    for (const note of notes) console.log(`  ${note}`);
  }
  if (dryRun) {
    console.log(`Dry run: ${changes.length} change(s), nothing written.`);
    return 0;
  }
  await applyEffectPromotion(repoRoot, changes);
  console.log(
    `Applied ${changes.length} change(s). git add them, update templates, thumbnails and pinned tests deliberately, then run the Included-content checks.`,
  );
  return 0;
}

async function runSave(argv, cwd) {
  const { positional, values, flags } = parseArgs(argv);
  if (flags.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  if (positional.length !== 1)
    throw new EffectSourceError("save takes one items.json file.");
  const origin =
    values["--url"] ??
    process.env.ANIMAMA_PUBLIC_ORIGIN ??
    "http://localhost:8000";
  const itemsFile = path.resolve(cwd, positional[0]);
  let jobs;
  const editor = await loadWebModule("/src/lib/avatar/vfx/editor/document.ts");
  try {
    let raw;
    try {
      raw = JSON.parse(await readFile(itemsFile, "utf8"));
    } catch (error) {
      throw new EffectSaveError(`${itemsFile}: ${error.message}`);
    }
    jobs = [];
    const names = new Set();
    for (const item of parseEffectSaveItems(raw, itemsFile)) {
      let effect;
      try {
        effect = await resolveEffectSource(item.source, { cwd });
      } catch (error) {
        throw new EffectSaveError(`${item.source}: ${error.message}`);
      }
      const name = item.name ?? effect.name;
      if (names.has(name))
        throw new EffectSaveError(
          `two items would save as "${name}"; give one a "name".`,
        );
      names.add(name);
      jobs.push({
        item,
        effect,
        ...(await importDocumentFor(effect, item, editor.module)),
      });
    }
  } catch (error) {
    if (
      !(error instanceof EffectSaveError) &&
      !(error instanceof EffectSourceError)
    )
      throw new EffectSaveError(error.message);
    throw error;
  } finally {
    await editor.close();
  }
  await saveEffects(jobs, origin, {
    // The creator's own document round trip, so defaults it omits and
    // defaults the API fills in compare equal.
    normalize: (definition) => {
      const placeholder = {
        logicalName: "image.png",
        originalName: "image.png",
        contentType: "image/png",
        sizeBytes: 1,
        sha256: null,
      };
      return editor.module.avatarEffectDefinition(
        editor.module.createAvatarEffectDocumentFromDefinition({
          name: "",
          description: "",
          definition,
          image: placeholder,
          otherEyeImage: placeholder,
          sound: null,
        }),
      );
    },
    onSaved: ({ name, url, revised }) =>
      console.log(`${revised ? "Revised" : "Saved"} ${name}: ${url}`),
  });
  return 0;
}

async function runCheck(argv, cwd) {
  const { positional, values, flags } = parseArgs(argv);
  if (flags.has("--help")) {
    console.log(USAGE);
    return 0;
  }
  if (!positional.length) throw new EffectSourceError("check needs sources.");
  const localContent = values["--local-content"]
    ? path.resolve(cwd, values["--local-content"])
    : defaultLocalContent();
  const times = parseTimes(values["--times"], DEFAULT_CHECK_TIMES);
  const effects = [];
  let ok = true;
  for (const spec of positional) {
    try {
      effects.push(await resolveEffectSource(spec, { cwd, localContent }));
    } catch (error) {
      if (!(error instanceof EffectSourceError)) throw error;
      console.log(`FAIL ${spec}: ${error.message}`);
      ok = false;
    }
  }
  if (effects.length) {
    const results = await checkEffects({ effects, times, localContent });
    for (const { stem, lines } of results) {
      for (const { level, message } of lines)
        console.log(`${level} ${stem}: ${message}`);
      if (lines.some((line) => line.level === "FAIL")) ok = false;
    }
    const failed = results.filter(({ lines }) =>
      lines.some((line) => line.level === "FAIL"),
    ).length;
    console.log(
      `${results.length} effect(s) checked: ${failed ? `${failed} failed` : "all passed"}.`,
    );
  }
  return ok ? 0 : 1;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  try {
    if (command === "check") return await runCheck(rest, cwd);
    if (command === "save") return await runSave(rest, cwd);
    if (command === "promote") return await runPromote(rest, cwd);
    console.log(USAGE);
    return command === "--help" ? 0 : 2;
  } catch (error) {
    if (error instanceof EffectSaveError) {
      console.log(`Save failed: ${error.message}`);
      return 1;
    }
    if (!(error instanceof EffectSourceError)) throw error;
    console.log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}
