import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url));
const nativeRoot = path.join(desktopRoot, "native/global-input-hook");
const outputRoot = path.join(desktopRoot, "dist/native");
const require = createRequire(new URL("../../package.json", import.meta.url));

/** Build the first-party N-API hook against the installed Node headers.
 * N-API keeps the result compatible with Electron's Node runtime. macOS Node
 * installs include headers; on Windows node-gyp downloads the matching headers
 * and node.lib, verified against nodejs.org's checksums.
 */
export function buildGlobalInputHook({
  platform = process.platform,
  arch = process.arch,
  execPath = process.execPath,
  runner = spawnSync,
} = {}) {
  if (!["darwin", "win32", "linux"].includes(platform)) {
    throw new Error(
      `Unsupported global input hook build platform: ${platform}`,
    );
  }
  const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js");
  const nodeRoot = [
    path.dirname(path.dirname(execPath)),
    path.dirname(execPath),
  ].find((candidate) =>
    existsSync(path.join(candidate, "include/node/node_api.h")),
  );
  const arguments_ = [
    nodeGyp,
    "rebuild",
    "--directory",
    nativeRoot,
    `--arch=${arch}`,
    ...(nodeRoot ? ["--nodedir", nodeRoot] : []),
  ];
  const result = runner(execPath, arguments_, {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ...(platform === "darwin" ? { MACOSX_DEPLOYMENT_TARGET: "15.0" } : {}),
    },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `First-party global input hook build failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  const source = path.join(nativeRoot, "build/Release/animama_input_hook.node");
  mkdirSync(outputRoot, { recursive: true });
  const output = path.join(outputRoot, "animama_input_hook.node");
  copyFileSync(source, output);
  return output;
}
