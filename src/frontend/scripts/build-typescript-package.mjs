import { build } from "esbuild";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageSourceDigest, SOURCE_DIGEST_FILE } from "./package-source-digest.mjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = process.cwd();
const outputRoot = join(packageRoot, "dist");
const entries = process.argv.slice(2);
if (entries.length === 0) throw new Error("Supply the package's public entry files.");

/** Run the workspace's pinned TypeScript compiler without a shell or global tools. */
async function emitDeclarations() {
  await new Promise((complete, fail) => {
    const child = spawn(process.execPath, [join(frontendRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], {
      cwd: packageRoot,
      stdio: "inherit",
    });
    child.once("error", fail);
    child.once("exit", (code) => code === 0 ? complete() : fail(new Error(`TypeScript declaration build failed (${code}).`)));
  });
}

/** Make emitted declaration references resolvable by both NodeNext and bundlers. */
async function normalizeDeclarationImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeDeclarationImports(path);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const source = await readFile(path, "utf8");
    if (/["'](?:@\/|@web\/)/.test(source)) {
      throw new Error(`Package declarations must not expose local aliases: ${path}`);
    }
    const replacements = new Map();
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])(\.[^"']+)\1/g)) {
      const specifier = match[2];
      if (/\.[a-z]+$/i.test(specifier)) continue;
      for (const [suffix, declarationSuffix] of [[".js", ".d.ts"], ["/index.js", "/index.d.ts"]]) {
        try {
          await access(resolve(dirname(path), specifier + declarationSuffix));
          replacements.set(specifier, specifier + suffix);
          break;
        } catch { /* An extensionless reference may target a directory. */ }
      }
    }
    let normalized = source;
    for (const [specifier, replacement] of replacements) {
      normalized = normalized.split(`"${specifier}"`).join(`"${replacement}"`).split(`'${specifier}'`).join(`'${replacement}'`);
    }
    if (normalized !== source) await writeFile(path, normalized);
  }
}

// Digest before building so source edited mid-build reads as stale afterwards.
const sourceDigest = await packageSourceDigest(packageRoot);
await mkdir(outputRoot, { recursive: true });
for (const entry of await readdir(outputRoot)) {
  await rm(join(outputRoot, entry), { recursive: true, force: true });
}
await emitDeclarations();
await normalizeDeclarationImports(join(outputRoot, "types"));
const result = await build({
  absWorkingDir: packageRoot,
  entryPoints: entries,
  outdir: outputRoot,
  bundle: true,
  metafile: true,
  write: false,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2023",
  packages: "external",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  loader: { ".svg": "file", ".png": "file", ".webp": "file", ".woff": "file", ".woff2": "file" },
  sourcemap: false,
  logLevel: "info",
});
// Bundling must never hide a dependency on another checkout's authored files.
// Public cross-package dependencies use declared bare imports and stay external.
const sourceRoot = join(packageRoot, "src");
for (const input of Object.keys(result.metafile.inputs)) {
  const path = relative(sourceRoot, resolve(packageRoot, input));
  if (isAbsolute(path) || path === ".." || path.startsWith("../")) {
    throw new Error(`Package build escaped its source boundary: ${input}`);
  }
}
for (const output of result.outputFiles) {
  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, output.contents);
}
await copyFile(resolve(frontendRoot, "../../LICENSE"), join(outputRoot, "LICENSE"));
// Written last, so a failed or interrupted build leaves no digest and never reads as current.
await writeFile(join(outputRoot, SOURCE_DIGEST_FILE), `${sourceDigest}\n`);
