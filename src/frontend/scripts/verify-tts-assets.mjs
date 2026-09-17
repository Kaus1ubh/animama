#!/usr/bin/env node
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { resolveBrowserRuntimeAssets } from "./browser-runtime-assets.mjs";

const root = path.resolve(process.cwd());
const requiredFiles = [
  "workers/inference-worker.js",
  "audio/pcm-processor.worklet.js",
  "vendor/sentencepiece.js",
];

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length && (args.length !== 2 || args[0] !== "--built-root"))
    throw new Error("Usage: verify-tts-assets.mjs [--built-root <web-output>]");
  const builtRoot = args.length ? path.resolve(args[1]) : undefined;
  const publicRoot = builtRoot ?? path.join(root, "web/public");
  for (const file of requiredFiles)
    await access(path.join(publicRoot, "tts", file));
  const assets = resolveBrowserRuntimeAssets({ builtRoot });
  console.log(
    `TTS assets verified: ${assets.length} exact browser runtime files (${assets.reduce((total, asset) => total + asset.size, 0)} bytes).`,
  );
}
main().catch((error) => {
  console.error(
    "TTS asset verification failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
