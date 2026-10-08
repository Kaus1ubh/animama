import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildGlobalInputHook } from "./native/build-global-input-hook.mjs";
import { assertBundledImports } from "./runtime/js-audit.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(path.join(root, "dist"), { recursive: true });
const metafile = { inputs: {}, outputs: {} };
for (const [entry, output, format] of [
  ["src/main.ts", "dist/main.js", "esm"],
  ["src/preload.cts", "dist/preload.cjs", "cjs"],
]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    target: "es2023",
    format,
    external: ["electron"],
    // The self-contained startup page embeds its font and logo.
    loader: { ".png": "dataurl", ".woff2": "dataurl" },
    metafile: true,
    // Bundled CJS dependencies can still require Node builtins when main is ESM.
    banner:
      format === "esm"
        ? {
            js: 'import { createRequire as __animamaCreateRequire } from "node:module"; const require = __animamaCreateRequire(import.meta.url);',
          }
        : undefined,
  });
  Object.assign(metafile.inputs, result.metafile.inputs);
  Object.assign(metafile.outputs, result.metafile.outputs);
}
assertBundledImports(metafile);
await buildGlobalInputHook();
// Build evidence is deliberately outside the distributed JS closure.
mkdirSync(path.join(root, ".desktop-runtime"), { recursive: true });
writeFileSync(
  path.join(root, ".desktop-runtime", "esbuild-meta.json"),
  `${JSON.stringify(metafile, null, 2)}\n`,
);
