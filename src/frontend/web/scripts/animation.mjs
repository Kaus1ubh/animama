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
  const { runMotionCli } = await server.ssrLoadModule(
    "/src/lib/avatar/motion-authoring/cli.ts",
  );
  exitCode = await runMotionCli(process.argv.slice(2), {
    avatarDirectory: path.resolve(webRoot, "../../../content/included/avatars"),
    cwd: process.env.INIT_CWD ?? process.cwd(),
    out: (text) => process.stdout.write(`${text}\n`),
    fileVersion: effectVersionForFile,
  });
} finally {
  await server.close();
}
process.exit(exitCode);
