#!/usr/bin/env node
/**
 * Run the development speech recognition benchmark (`web/speech-bench.html`,
 * issue #509) in Electron, the desktop renderer's runtime, and save its result
 * with the runtime, cold and warm load time and peak memory.
 *
 * Start a Vite development server first, then from `src/frontend`:
 *
 *   pnpm speech:bench --app http://127.0.0.1:5179 --engine parakeet \
 *     --backend wasm --mode throughput [--sets en,ja] [--limit 5] \
 *     [--interim 0|1] [--models URL] [--gpuModels URL] [--out FILE]
 *
 * Each run uses a fresh Electron profile and two launches: a load-only launch
 * measures the cold load, then a second launch on the now-populated profile
 * measures the warm load and transcribes the clips. Peak memory (macOS
 * `footprint`, so this runner targets the reference Mac) comes from the second
 * launch only, so it describes one loaded model as in the app.
 *
 * Clips are served from the evaluation root prepared by
 * `scripts/speech-eval/speech_eval.py fetch`; results are written under its
 * `results/` directory and scored with `speech_eval.py score`.
 */
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { _electron } from "playwright";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(frontendRoot, "../..");
const MEMORY_SAMPLE_MS = 2000;

const { values: args } = parseArgs({
  options: {
    app: { type: "string" },
    engine: { type: "string", default: "parakeet" },
    backend: { type: "string", default: "wasm" },
    mode: { type: "string", default: "throughput" },
    interim: { type: "string" },
    sets: { type: "string" },
    limit: { type: "string" },
    models: { type: "string" },
    gpuModels: { type: "string" },
    out: { type: "string" },
  },
});
if (!args.app) {
  throw new Error("--app <Vite development server URL> is required");
}

const evalRoot = execFileSync(
  "python3",
  [path.join(repoRoot, "scripts/speech-eval/speech_eval.py"), "root"],
  { encoding: "utf8" },
).trim();
const electronPath = createRequire(
  path.join(frontendRoot, "desktop/package.json"),
)("electron");

/** Serve the evaluation root to the app origin only, without caching. */
function serveEvalRoot(appOrigin) {
  const server = createServer((request, response) => {
    let size = null;
    let file = null;
    try {
      const relative = decodeURIComponent(
        new URL(request.url, "http://local").pathname,
      );
      file = path.resolve(evalRoot, `.${relative}`);
      if (
        file.startsWith(`${evalRoot}${path.sep}`) &&
        statSync(file).isFile()
      ) {
        size = statSync(file).size;
      }
    } catch {
      size = null;
    }
    response.setHeader("Access-Control-Allow-Origin", appOrigin);
    response.setHeader("Cache-Control", "no-store");
    if (size === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Length": size });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

const UNITS = { B: 1 / 1024 / 1024, KB: 1 / 1024, MB: 1, GB: 1024 };

/**
 * Memory footprint, in MB, of a process and its descendants, by Electron
 * process type (`main`, `renderer`, `gpu-process`, `utility`). Uses macOS
 * `footprint`, what Activity Monitor shows, which unlike RSS does not count
 * shared clean pages once per process.
 */
function treeFootprintMb(rootPid) {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .map((line) => {
      const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      const type = command.match(/--type=([a-z-]+)/)?.[1] ?? "main";
      return { pid: Number(pid), ppid: Number(ppid), type };
    });
  const tree = new Map([[rootPid, "main"]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { pid, ppid, type } of rows) {
      if (tree.has(ppid) && !tree.has(pid)) {
        tree.set(pid, type);
        grew = true;
      }
    }
  }
  const report = execFileSync(
    "footprint",
    [...tree.keys()].flatMap((pid) => ["-p", String(pid)]),
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const byType = {};
  for (const [, pid, value, unit] of report.matchAll(
    /\[(\d+)\]: \d+-bit\s+Footprint: ([\d.]+) (B|KB|MB|GB)/g,
  )) {
    const type = tree.get(Number(pid)) ?? "main";
    byType[type] = (byType[type] ?? 0) + Number(value) * UNITS[unit];
  }
  return byType;
}

const sum = (byType) => Object.values(byType).reduce((a, b) => a + b, 0);

/**
 * Footprint of the Electron process tree, sampled every two seconds and split
 * by the page's phase (loading the model, then transcribing clips). Peaks swing
 * with garbage-collection timing, so the clip phase also reports its median.
 * The per-process-type breakdown is taken at the clip-phase peak.
 */
function trackMemory(rootPid, page) {
  const peaks = { loading: { total: 0 }, clips: { total: 0, byType: {} } };
  const clipSamples = [];
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const phase = await page
        .evaluate(() => window.__speechBenchPhase ?? "loading")
        .catch(() => "loading");
      let byType;
      try {
        byType = treeFootprintMb(rootPid);
      } catch {
        return; // A process exited between listing and sampling.
      }
      const total = sum(byType);
      if (phase === "clips") clipSamples.push(total);
      if (total > (peaks[phase]?.total ?? 0)) peaks[phase] = { total, byType };
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(sample, MEMORY_SAMPLE_MS);
  void sample();
  return () => {
    clearInterval(timer);
    const round = (byType = {}) =>
      Object.fromEntries(
        Object.entries(byType).map(([type, mb]) => [type, Math.round(mb)]),
      );
    // No sample (a phase shorter than the interval, or every sample failed)
    // is reported as null, not as a measured zero.
    const mb = (value) => (value > 0 ? Math.round(value) : null);
    const sorted = [...clipSamples].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median =
      sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return {
      loadPeakMb: mb(peaks.loading.total),
      medianMb: mb(median ?? 0),
      peakMb: mb(peaks.clips.total),
      peakByProcessMb: peaks.clips.total > 0 ? round(peaks.clips.byType) : null,
    };
  };
}

/** Launch Electron on `userData`, open `url` and wait for the page's result. */
async function runPage(url, userData, { measureMemory }) {
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [path.join(frontendRoot, "scripts/speech-bench-electron-main.cjs")],
    env: {
      ...process.env,
      SPEECH_BENCH_URL: url,
      SPEECH_BENCH_USER_DATA: userData,
    },
  });
  const page = await app.firstWindow();
  const stopMemory = measureMemory
    ? trackMemory(app.process().pid, page)
    : () => null;
  const progress = setInterval(async () => {
    const text = await page
      .locator("#status")
      .textContent()
      .catch(() => null);
    if (text) console.info(`[speech-bench] ${text}`);
  }, 15_000);
  try {
    await page.waitForFunction(
      () => window.__speechBenchResult !== undefined,
      null,
      { timeout: 0 },
    );
    const result = await page.evaluate(() => window.__speechBenchResult);
    if ("error" in result) throw new Error(`Benchmark failed: ${result.error}`);
    const versions = await app.evaluate(() => process.versions);
    return {
      result,
      memory: stopMemory(),
      runtime: `electron ${versions.electron} (chromium ${versions.chrome})`,
    };
  } finally {
    clearInterval(progress);
    stopMemory();
    await app.close();
  }
}

async function main() {
  const server = await serveEvalRoot(new URL(args.app).origin);
  const query = new URLSearchParams({
    engine: args.engine,
    backend: args.backend,
    mode: args.mode,
    clips: `http://127.0.0.1:${server.address().port}/clips`,
  });
  for (const name of ["interim", "sets", "limit", "models", "gpuModels"]) {
    if (args[name] !== undefined) query.set(name, args[name]);
  }
  const url = `${args.app.replace(/\/$/, "")}/speech-bench.html?${query}`;
  // A fresh profile per run: no HTTP, code or Chromium GPU cache from an
  // earlier run (macOS keeps its own Metal cache and file cache).
  const userData = mkdtempSync(path.join(os.tmpdir(), "speech-bench-"));
  try {
    const cold = await runPage(`${url}&loadOnly=1`, userData, {
      measureMemory: false,
    });
    const warm = await runPage(url, userData, { measureMemory: true });
    const { loadMs, ...result } = warm.result;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const variant =
      result.mode === "paced" && result.interim ? "paced-interim" : result.mode;
    const out =
      args.out ??
      path.join(
        evalRoot,
        "results",
        `${result.engine}-${result.backend}-${variant}-electron-${stamp}.json`,
      );
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          ...result,
          coldLoadMs: cold.result.loadMs,
          warmLoadMs: loadMs,
          runtime: warm.runtime,
          memory: {
            ...warm.memory,
            method:
              "peak summed macOS footprint of the Electron process tree in the warm launch, sampled every two seconds; medianMb and peakMb while transcribing clips (peakByProcessMb splits the peak by process type), loadPeakMb while loading",
          },
        },
        null,
        1,
      )}\n`,
    );
    console.info(`[speech-bench] ${result.clips.length} clips → ${out}`);
  } finally {
    rmSync(userData, { recursive: true, force: true });
    server.close();
  }
}

await main();
