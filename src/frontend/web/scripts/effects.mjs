import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CHECK_TIMES,
  checkEffects,
  particleSourceLines,
  sceneImageLines,
  sceneLimitLines,
} from "./effect-check.mjs";
import { parseTimes } from "./effect-render.mjs";
import {
  EffectSourceError,
  resolveAnyEffectSource,
  resolveClipSource,
  sceneDefinitionImageUses,
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
  SAVE_CREATORS,
  importDocumentFor,
  localEntryName,
  parseEffectSaveItems,
  saveEffects,
} from "./effect-save.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
/** Local content of the sourced stack, for `library:local/...` sources. */
const defaultLocalContent = () =>
  process.env.ANIMAMA_LOCAL_CONTENT_HOST_PATH ?? null;

const VALUE_OPTIONS = new Set([
  "--times",
  "--with-clip",
  "--local-content",
  "--url",
]);
/** The source kind a promote item's `library:` spec names, by item kind. */
const PROMOTE_SOURCE_KINDS = {
  avatar_effect: "effect",
  particle_effect: "particle",
  scene_effect: "scene",
};
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
 * alias resolve as in the app; `load` loads another module through the same
 * loader and `close` stops it.
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
      load: (other) => server.ssrLoadModule(other),
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

/**
 * Avatar, Particle and Scene Effect authoring commands, the effect
 * counterpart of `pnpm -s animation`:
 *
 *   pnpm -s effects check <source...> [--times 0.25,1] [--with-clip <clip>]
 *     [--local-content <dir>]
 *   pnpm -s effects save <items.json> [--url <app origin>]
 *   pnpm -s effects promote <items.json> [--dry-run]
 *
 * A source is an effect folder, a descriptor `.json`, or
 * `library:[particle-effect/|scene-effect/][included/|local/]<stem|content_id|name>`,
 * as for `effects:render`;
 * so is `--with-clip`'s Gesture (a clip file, Gesture folder or
 * `library:<gesture>`).
 */

const USAGE = [
  "Usage:",
  "  pnpm -s effects check <source...> [--times 0.25,1] [--with-clip <clip>]",
  "                         [--local-content <dir>]",
  "  pnpm -s effects save <items.json> [--url <app origin>]",
  "  pnpm -s effects promote <items.json> [--dry-run]",
  "",
  "check: an Avatar, Particle or Scene effect folder or library: spec",
  "(library:particle-effect/…, library:scene-effect/…). Checks the art against",
  "its budget, the definition as the runtime parses it, a Particle Effect's",
  "particle count against its declared budget and the 512-particle limit, own",
  "Particle textures named like a built-in creator texture (Save would keep the",
  "built-in art), the effect on both Included Avatars, and visible art (each",
  "Avatar must show the effect in some frame; Scene layers are captured as the",
  "chat draws them).",
  "Exits 1 when any effect has a FAIL.",
  "--with-clip <clip.json|Gesture folder|library:<gesture>> poses both Avatars",
  "with that Gesture at each --times (seconds from its start, the effect",
  "applied at 0), so art on a bone the Gesture moves, such as a hand, is",
  "checked where the Gesture puts it.",
  "",
  'save: items.json is [{ "source": "<effect folder>", "name"?, "description"? }].',
  "Each Avatar, Particle or Scene source is saved as a Local effect through its",
  "creator (a Local effect of that kind with the same name is revised), read",
  "back, compared with the source and reopened. The origin defaults to",
  "ANIMAMA_PUBLIC_ORIGIN (source the stack record), then http://localhost:8000.",
  "",
  "promote: only with the owner's explicit approval of each item, on a task",
  'branch and PR. Items: { "kind"?, "source", "stem", "mode": "add" | "replace",',
  '"name"?, "description"? } or { "kind"?, "stem", "mode": "delete" }, "kind"',
  'being "avatar_effect" (default), "particle_effect" or "scene_effect".',
  '"source" is library:local/<name> (the sourced stack\'s Local content) or an',
  'effect folder. Reactions and Gestures: { "kind": "reaction" | "gesture",',
  '"stem", "source": "<creator project .json>", "mode": "replace" }; their',
  "dependencies on Local effects promoted in the same run become the Included",
  "effects. --dry-run lists every change and writes nothing.",
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
    const { default: prettier } = await import("prettier");
    const { validateAnimaPoseClipV2 } = await validator.load(
      "/src/lib/avatar/poses/animaPoseClip/schemaV2.ts",
    );
    for (const item of items) {
      if (item.mode === "delete") continue;
      if (!PROMOTE_SOURCE_KINDS[item.kind]) {
        if (item.source.startsWith("library:"))
          throw new EffectPromoteError(
            `${item.stem}: a ${item.kind} source is a creator project file.`,
          );
        const file = path.resolve(path.dirname(itemsFile), item.source);
        try {
          item.project = JSON.parse(await readFile(file, "utf8"));
        } catch (error) {
          throw new EffectPromoteError(`${item.stem}: ${error.message}`);
        }
        continue;
      }
      try {
        item.effect = await resolveAnyEffectSource(item.source, {
          cwd: path.dirname(itemsFile),
          localContent,
          defaultKind: PROMOTE_SOURCE_KINDS[item.kind],
        });
        const descriptor = JSON.parse(
          await readFile(item.effect.descriptorPath, "utf8"),
        );
        item.effect.dependencies = descriptor.dependencies ?? [];
      } catch (error) {
        throw new EffectPromoteError(`${item.stem}: ${error.message}`);
      }
    }
    const { sceneEntryFromDefinition } = await validator.load(
      "/src/lib/scene-vfx/sceneDefinition.ts",
    );
    // Particle and Scene sources are judged by the same lines as
    // `effects check`; any FAIL refuses the item.
    const refuseFails = (lines) => {
      const fails = lines.filter((line) => line.level === "FAIL");
      if (fails.length)
        throw new Error(fails.map((line) => line.message).join("; "));
    };
    const server = { ssrLoadModule: validator.load };
    changes = await planEffectPromotion(items, {
      repo: workingTreeRepo(repoRoot),
      validate: validator.module.validateAvatarEffectDefinition,
      validateParticle: async (effect) =>
        refuseFails(await particleSourceLines(effect, server)),
      validateScene: async (effect) => {
        try {
          sceneEntryFromDefinition(
            effect.definition,
            { id: effect.stem, label: effect.name },
            (image) => (effect.imagePaths[image] ? `file:${image}` : null),
          );
        } catch (error) {
          throw new Error(
            `the Scene definition does not parse (${error.message}).`,
          );
        }
        refuseFails([
          ...sceneImageLines(effect),
          ...(await sceneLimitLines(effect, server)),
        ]);
      },
      formatJson: (value) =>
        prettier.format(JSON.stringify(value, null, 2), { parser: "json" }),
      validateClip: (clip) => {
        const result = validateAnimaPoseClipV2(clip);
        if (!result.ok)
          throw new Error(
            `invalid animaPoseClip/2.0: ${result.issues
              .slice(0, 3)
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join("; ")}`,
          );
      },
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
  const loader = await loadWebModule("/src/lib/avatar/vfx/editor/document.ts");
  // Each creator's own document functions, so the import documents and the
  // comparisons are exactly what the creators write.
  const editors = {
    avatar: loader.module,
    particle: {
      ...(await loader.load("/src/lib/avatar/particle-vfx/editor/index.ts")),
      ...(await loader.load("/src/lib/avatar/particle-vfx/runtimeConfig.ts")),
    },
    scene: await loader.load("/src/lib/scene-vfx/editor/document.ts"),
  };
  try {
    let raw;
    try {
      raw = JSON.parse(await readFile(itemsFile, "utf8"));
    } catch (error) {
      throw new EffectSaveError(`${itemsFile}: ${error.message}`);
    }
    jobs = [];
    const folders = new Set();
    for (const item of parseEffectSaveItems(raw, itemsFile)) {
      let effect;
      try {
        effect = await resolveAnyEffectSource(item.source, { cwd });
      } catch (error) {
        throw new EffectSaveError(`${item.source}: ${error.message}`);
      }
      const job = {
        item,
        effect,
        ...(await importDocumentFor(effect, item, editors)),
      };
      const folder = `${SAVE_CREATORS[effect.kind].folder}/${localEntryName(job.name)}/`;
      if (folders.has(folder))
        throw new EffectSaveError(
          `two items would save to ${folder}; give one another "name".`,
        );
      folders.add(folder);
      jobs.push(job);
    }
  } catch (error) {
    await loader.close();
    if (
      !(error instanceof EffectSaveError) &&
      !(error instanceof EffectSourceError)
    )
      throw new EffectSaveError(error.message);
    throw error;
  }
  for (const { effect, name } of jobs)
    console.log(
      `${name} → Local folder ${SAVE_CREATORS[effect.kind].folder}/${localEntryName(name)}/`,
    );
  const placeholder = {
    contentType: "image/png",
    sizeBytes: 1,
    sha256: null,
  };
  const image = (logicalName) => ({
    ...placeholder,
    logicalName,
    originalName: logicalName,
  });
  try {
    await saveEffects(jobs, origin, {
      // Each creator's own round trip, so defaults it omits and defaults the
      // API fills in compare equal.
      normalize: {
        avatar: (definition) =>
          editors.avatar.avatarEffectDefinition(
            editors.avatar.createAvatarEffectDocumentFromDefinition({
              name: "",
              description: "",
              definition,
              image: image("image.png"),
              otherEyeImage: image("image.png"),
              sound: null,
            }),
          ),
        particleSettings: (settings) =>
          editors.particle.particleVFXRuntimeSlotConfig({
            ...editors.particle.parseParticleVFXRuntimeConfig(settings ?? {}),
            label: settings?.label,
            description: settings?.description,
          }),
        particleQuarks: (quarks) =>
          editors.particle.createParticleVFXEditorDraftFromImport(quarks)
            .quarksJson,
        scene: (definition) =>
          editors.scene.sceneEffectDefinition(
            editors.scene.createSceneEffectDocumentFromDefinition({
              name: "",
              description: "",
              definition,
              images: new Map(
                sceneDefinitionImageUses(definition).map(({ image: name }) => [
                  name,
                  image(name),
                ]),
              ),
              sound: null,
            }),
          ),
      },
      onSaved: ({ name, url, revised }) =>
        console.log(`${revised ? "Revised" : "Saved"} ${name}: ${url}`),
    });
  } finally {
    await loader.close();
  }
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
  // The Gesture's pose, resolved as effects:render --with-clip resolves it.
  const posed = values["--with-clip"]
    ? await resolveClipSource(values["--with-clip"], { cwd, localContent })
    : null;
  const effects = [];
  let ok = true;
  for (const spec of positional) {
    try {
      effects.push(await resolveAnyEffectSource(spec, { cwd, localContent }));
    } catch (error) {
      if (!(error instanceof EffectSourceError)) throw error;
      console.log(`FAIL ${spec}: ${error.message}`);
      ok = false;
    }
  }
  if (effects.length) {
    if (posed)
      console.log(
        `Posed by ${path.relative(cwd, posed.clipPath) || posed.clipPath} at ${times.join("s, ")}s.`,
      );
    const results = await checkEffects({
      effects,
      times,
      localContent,
      clip: posed?.clip ?? null,
    });
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
