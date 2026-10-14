#!/usr/bin/env node
/**
 * Lip-sync evaluation commands.
 *
 *   pnpm lipsync:eval [--source estimated,aligned,...] [--mode whole,faster,live] [--json out.json]
 *     Score plan sources on the committed fixtures (tests/lipsync/fixtures).
 *     Offline: no network, no paid speech. Opt-in sources, such as
 *     aligned-full, run only when named.
 *
 *   pnpm lipsync:fixtures --clips <dir> [--only id,...]
 *     Rebuild fixtures from a maintainer clip directory made with
 *     scripts/lipsync/clips.py (WAV files, recorded timing, reference.json and
 *     estimated.json). The audio itself is never written to the repository.
 *
 *   pnpm lipsync:captures --clips <dir> --out <dir> [--only id,...]
 *     Write capture files the debug panel's Lip-sync view can load ("Load
 *     capture", development only), one per clip. They hold the audio, so --out
 *     must be outside the repository.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const lipsyncTests = path.join(webRoot, "tests/lipsync");
const fixturesDir = path.join(lipsyncTests, "fixtures");

/** Load web modules through Vite's SSR loader, so TypeScript and the `@` alias resolve. */
async function createLoader() {
  const { createServer } = await import("vite");
  const server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    logLevel: "error",
    appType: "custom",
    cacheDir: path.join(webRoot, "node_modules/.vite-lipsync-cli"),
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
    // Nothing here runs in a browser, so skip the dependency scan.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  return {
    load: (file) => server.ssrLoadModule(file),
    close: () => server.close(),
  };
}

/** 16-bit PCM from a WAV file, mixed to mono. */
function decodeWav(buffer) {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= view.byteLength) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`Expected 16-bit PCM, got ${bits}-bit`);
      const count = Math.floor(size / 2 / channels);
      const pcm = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        let sum = 0;
        for (let c = 0; c < channels; c += 1) {
          sum += view.getInt16(body + (i * channels + c) * 2, true);
        }
        pcm[i] = sum / channels / 32768;
      }
      return { pcm, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/** A clip's recorded provider timing, if it has any. */
async function readRecordedTiming(clipsDir, id, sampleRate) {
  const socketPath = path.join(clipsDir, `${id}.socket.json`);
  const httpPath = path.join(clipsDir, `${id}.alignment.json`);
  if (existsSync(socketPath)) {
    return {
      kind: "socket",
      sampleRate,
      messages: (await readJson(socketPath)).messages,
    };
  }
  if (existsSync(httpPath)) {
    return { kind: "http", alignment: await readJson(httpPath) };
  }
  return null;
}

async function buildFixtures(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { clips: { type: "string" }, only: { type: "string" } },
  });
  if (!values.clips) throw new Error("--clips <dir> is required");
  const clipsDir = path.resolve(values.clips);
  const only = values.only ? new Set(values.only.split(",")) : null;
  const { lines } = await readJson(path.join(lipsyncTests, "testset.json"));
  const reference = await readJson(path.join(clipsDir, "reference.json"));
  const estimated = await readJson(path.join(clipsDir, "estimated.json"));

  const loader = await createLoader();
  try {
    const { buildEvalClip } = await loader.load(
      "/src/lib/lipsync/eval/build.ts",
    );
    const { encodeEvalClip } = await loader.load(
      "/src/lib/lipsync/eval/clip.ts",
    );
    await mkdir(fixturesDir, { recursive: true });
    let written = 0;
    for (const line of lines) {
      if (only && !only.has(line.id)) continue;
      const wavPath = path.join(clipsDir, `${line.id}.wav`);
      if (!existsSync(wavPath)) {
        console.warn(`${line.id}: no clip, skipped`);
        continue;
      }
      if (!reference[line.id])
        throw new Error(`${line.id}: no reference alignment`);
      const { pcm, sampleRate } = decodeWav(await readFile(wavPath));
      const timing = await readRecordedTiming(clipsDir, line.id, sampleRate);
      const estimatedInputs = estimated[line.id];
      const clip = buildEvalClip({
        meta: {
          id: line.id,
          provider: line.provider,
          model: line.model,
          voice: line.voice,
          lang: line.lang,
          text: line.text,
          set: line.set,
          groups: line.groups,
          heldOut: line.heldOut,
          intervalTags: line.intervalTags,
        },
        pcm,
        sampleRate,
        timing,
        alignment: reference[line.id],
        estimated: estimatedInputs?.phonemizedText?.length
          ? estimatedInputs
          : null,
      });
      await writeFile(
        path.join(fixturesDir, `${line.id}.json`),
        `${JSON.stringify(encodeEvalClip(clip))}\n`,
      );
      written += 1;
    }
    console.log(`fixtures written: ${written}`);
  } finally {
    await loader.close();
  }
}

async function writeCaptures(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      clips: { type: "string" },
      out: { type: "string" },
      only: { type: "string" },
    },
  });
  if (!values.clips || !values.out)
    throw new Error("--clips <dir> and --out <dir> are required");
  const clipsDir = path.resolve(values.clips);
  const outDir = path.resolve(values.out);
  const repoRoot = path.resolve(webRoot, "../../..");
  if (!path.relative(repoRoot, outDir).startsWith("..")) {
    throw new Error(
      "--out must be outside the repository: captures hold audio",
    );
  }
  const only = values.only ? new Set(values.only.split(",")) : null;
  const { lines } = await readJson(path.join(lipsyncTests, "testset.json"));
  const estimatedPath = path.join(clipsDir, "estimated.json");
  const estimated = existsSync(estimatedPath)
    ? await readJson(estimatedPath)
    : {};

  const loader = await createLoader();
  try {
    const { timingFromRecording } = await loader.load(
      "/src/lib/lipsync/eval/build.ts",
    );
    const { encodeLipSyncCapture } = await loader.load(
      "/src/lib/lipsync/capture-file.ts",
    );
    await mkdir(outDir, { recursive: true });
    let written = 0;
    for (const line of lines) {
      if (only && !only.has(line.id)) continue;
      // The app plays these providers; others were recorded for scoring only.
      if (!["elevenlabs", "gemini", "pocket"].includes(line.provider)) continue;
      const wavPath = path.join(clipsDir, `${line.id}.wav`);
      if (!existsSync(wavPath)) {
        console.warn(`${line.id}: no clip, skipped`);
        continue;
      }
      const { pcm, sampleRate } = decodeWav(await readFile(wavPath));
      const recording = await readRecordedTiming(clipsDir, line.id, sampleRate);
      const estimatedInputs = estimated[line.id];
      const capture = encodeLipSyncCapture({
        id: line.id,
        provider: line.provider,
        sampleRate,
        pcm: Int16Array.from(pcm, (value) =>
          Math.max(-32768, Math.min(32767, Math.round(value * 32768))),
        ),
        text: line.text,
        // Gemini speaks a reply in parts; a clip is one.
        parts:
          line.provider === "gemini" ? [{ sample: 0, text: line.text }] : [],
        timing: recording ? timingFromRecording(recording) : [],
        estimated: estimatedInputs?.phonemizedText?.length
          ? {
              phonemizedText: estimatedInputs.phonemizedText,
              tokenizedText: estimatedInputs.tokenizedText ?? null,
            }
          : null,
      });
      await writeFile(
        path.join(outDir, `${line.id}.json`),
        `${JSON.stringify(capture)}\n`,
      );
      written += 1;
    }
    console.log(`captures written to ${outDir}: ${written}`);
  } finally {
    await loader.close();
  }
}

async function runEvaluation(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      mode: { type: "string", default: "whole,faster,live" },
      json: { type: "string" },
      only: { type: "string" },
    },
  });
  const loader = await createLoader();
  try {
    const { decodeEvalClip } = await loader.load(
      "/src/lib/lipsync/eval/clip.ts",
    );
    const { evaluate, evaluationJson, formatEvaluation } = await loader.load(
      "/src/lib/lipsync/eval/evaluate.ts",
    );
    const { EVAL_PLAN_SOURCES } = await loader.load(
      "/src/lib/lipsync/eval/sources.ts",
    );
    const only = values.only ? new Set(values.only.split(",")) : null;
    const files = (await readdir(fixturesDir))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const clips = [];
    for (const file of files) {
      const clip = decodeEvalClip(await readJson(path.join(fixturesDir, file)));
      if (!only || only.has(clip.id)) clips.push(clip);
    }
    const wanted = values.source ? new Set(values.source.split(",")) : null;
    const sources = EVAL_PLAN_SOURCES.filter((source) =>
      wanted ? wanted.has(source.id) : !source.optIn,
    );
    if (!sources.length)
      throw new Error(`No plan source matches ${values.source}`);
    for (const source of sources) await source.prepare?.();
    const modes = values.mode.split(",");
    const rows = evaluate(clips, sources, modes);
    console.log(formatEvaluation(rows));
    if (values.json) {
      await writeFile(
        values.json,
        `${JSON.stringify(evaluationJson(rows), null, 1)}\n`,
      );
      console.log(`\nwrote ${values.json}`);
    }
  } finally {
    await loader.close();
  }
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  eval: runEvaluation,
  fixtures: buildFixtures,
  captures: writeCaptures,
};
if (!commands[command]) {
  console.error(
    "Usage: node scripts/lipsync.mjs <eval|fixtures|captures> [options]",
  );
  process.exit(2);
}
await commands[command](rest);
