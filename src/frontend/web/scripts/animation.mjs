import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import { effectVersionForFile } from "./animation-preview-media.mjs";

// Run the motion-authoring CLI (src/lib/avatar/motion-authoring/cli.ts)
// through Vite's SSR loader so TypeScript and the `@` alias resolve as in the app.
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: false,
  root: webRoot,
  publicDir: false,
  logLevel: "error",
  appType: "custom",
  cacheDir: path.join(webRoot, "node_modules/.vite-animation-cli"),
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
let exitCode = 1;
try {
  const { runMotionCli, compactClipFile } = await server.ssrLoadModule(
    "/src/lib/avatar/motion-authoring/cli.ts",
  );
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const out = (text) => process.stdout.write(`${text}\n`);
  if (command === "promote") {
    // Writes repository files, so it lives beside the other repo scripts and
    // only borrows the CLI's validation and saved-file serializer.
    const { runPromote } = await import("./animation-promote.mjs");
    exitCode = await runPromote(rest, {
      repoRoot: path.resolve(webRoot, "../../.."),
      cwd,
      compactClip: compactClipFile,
      maxClipBytes: (
        await server.ssrLoadModule(
          "/src/lib/avatar/poses/animaPoseClip/index.ts",
        )
      ).MAX_ANIMA_POSE_CLIP_BYTES,
      // File paths and `library:` sources resolve exactly as in the preview.
      resolveClip: async (spec, directory) => {
        const { resolvePreviewSource } = await server.ssrLoadModule(
          "/src/lib/avatar/motion-authoring/preview/sources.ts",
        );
        const localContent = process.env.ANIMAMA_LOCAL_CONTENT_HOST_PATH;
        const source = await resolvePreviewSource(spec, {
          cwd: directory,
          included: path.resolve(webRoot, "../../../content/included"),
          local: localContent ? path.resolve(cwd, localContent) : null,
        });
        return source.path;
      },
      out,
    });
  } else {
    exitCode = await runMotionCli(process.argv.slice(2), {
      avatarDirectory: path.resolve(
        webRoot,
        "../../../content/included/avatars",
      ),
      cwd,
      out,
      fileVersion: effectVersionForFile,
    });
  }
} finally {
  await server.close();
}
process.exit(exitCode);
