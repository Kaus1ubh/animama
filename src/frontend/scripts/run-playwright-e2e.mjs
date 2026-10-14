import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";

import {
  acquireMainStackLock,
  assertExecutableExists,
  checkDevelopmentApplication,
  checkHttpHealth,
  createExclusiveDirectory,
  ensurePrivateDirectory,
  extractJourneyFilters,
  formatGeneratedId,
  readGitMetadata,
  redactEvidence,
  releaseMainStackLock,
  resolvePackageBinary,
  resolveE2eLocalContentRoot,
  resolveE2eEnvironment,
  writePrivateJson,
} from "./e2e/run-support.mjs";
import { cleanupOwnedContent } from "./e2e/content-cleanup.mjs";
import {
  readContentLedger,
  summarizeContentLedger,
  unresolvedContentWork,
} from "./e2e/content-ledger.mjs";
import { createLocalCatalogClient } from "./e2e/local-catalog-client.mjs";
import { validateLocalContentRoot } from "./e2e/local-content-verifier.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(frontendRoot, "../..");
const generatedRoot = path.join(repositoryRoot, ".animama-e2e");
const playwrightConfigPath = path.join(frontendRoot, "playwright.config.ts");
/** Runner flag selecting the pseudo-locale smoke suite instead of the journeys. */
const PSEUDO_LOCALE_FLAG = "--pseudo-locale";

function relativeToRepository(absolutePath) {
  return path.relative(repositoryRoot, absolutePath);
}

function createArtifactPaths(runDirectory) {
  const playwrightDirectory = path.join(runDirectory, "playwright");
  return {
    runDirectory,
    manifest: path.join(runDirectory, "manifest.json"),
    runnerLog: path.join(runDirectory, "runner.log"),
    evidenceDirectory: path.join(runDirectory, "evidence"),
    playwrightDirectory,
    htmlReport: path.join(playwrightDirectory, "html-report"),
    jsonResults: path.join(playwrightDirectory, "results.json"),
    outputDirectory: path.join(playwrightDirectory, "output"),
    contentLedger: path.join(runDirectory, "content-ledger.jsonl"),
    cleanupSummary: path.join(runDirectory, "cleanup-summary.json"),
  };
}

function summarizeContentLedgerLifecycle(events) {
  const states = summarizeContentLedger(events);
  return {
    eventCount: events.length,
    plannedItemCount: states.length,
    ownedItemCount: states.filter((state) => state.owned).length,
    verifiedItemCount: states.filter((state) => state.verified).length,
    deletedItemCount: states.filter((state) => state.last?.event === "deleted")
      .length,
    cleanupFailedItemCount: states.filter(
      (state) => state.last?.event === "cleanup_failed",
    ).length,
  };
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  process.umask(0o077);

  const runnerArguments = process.argv
    .slice(2)
    .filter((value) => value !== "--");
  // The pseudo-locale smoke is its own suite (see playwright.config.ts); the
  // runner always sets the selection so an inherited value cannot switch it.
  const pseudoLocale = runnerArguments.includes(PSEUDO_LOCALE_FLAG);
  const suite = pseudoLocale ? "pseudo" : "journeys";
  const playwrightArguments = runnerArguments.filter(
    (value) => value !== PSEUDO_LOCALE_FLAG,
  );
  // Listing is offline: no browser, health request, stack mutation or account setup.
  if (playwrightArguments.includes("--list")) {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "animama-e2e-list-"),
    );
    try {
      const packagePath = require.resolve("playwright/package.json");
      const manifest = JSON.parse(await readFile(packagePath, "utf8"));
      const child = spawn(
        process.execPath,
        [
          resolvePackageBinary(packagePath, manifest, "playwright"),
          "test",
          "--config",
          playwrightConfigPath,
          ...playwrightArguments,
        ],
        {
          cwd: frontendRoot,
          stdio: "inherit",
          env: {
            ...process.env,
            ANIMAMA_E2E_WEB_URL: "http://localhost:1",
            ANIMAMA_E2E_PLAYWRIGHT_DIR: directory,
            ANIMAMA_E2E_SUITE: suite,
          },
        },
      );
      process.exitCode = (await waitForChild(child)).code ?? 1;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return;
  }
  const headed = playwrightArguments.includes("--headed");
  const runId = formatGeneratedId(
    process.env.ANIMAMA_E2E_RUN_TYPE ?? (pseudoLocale ? "pseudo" : "run"),
  );
  const runDirectory = path.join(generatedRoot, "runs", runId);
  const artifacts = createArtifactPaths(runDirectory);
  const target = resolveE2eEnvironment();
  const lockPath = path.join(
    generatedRoot,
    "locks",
    `${target.composeProject}.lock`,
  );
  const localContentRoot = resolveE2eLocalContentRoot(repositoryRoot);
  const git = await readGitMetadata(repositoryRoot);
  const playwrightPackagePath = require.resolve("playwright/package.json");
  const playwrightPackage = JSON.parse(
    await readFile(playwrightPackagePath, "utf8"),
  );
  const chromiumExecutable = chromium.executablePath();

  await ensurePrivateDirectory(generatedRoot);
  await createExclusiveDirectory(runDirectory);
  await Promise.all([
    ensurePrivateDirectory(artifacts.evidenceDirectory),
    ensurePrivateDirectory(artifacts.playwrightDirectory),
    ensurePrivateDirectory(artifacts.outputDirectory),
  ]);
  const ledgerHandle = await open(artifacts.contentLedger, "wx", 0o600);
  await ledgerHandle.close();
  await writePrivateJson(artifacts.cleanupSummary, {
    status: "pending",
    attempted: 0,
    deleted: 0,
    failed: 0,
  });

  const logStream = createWriteStream(artifacts.runnerLog, {
    flags: "a",
    mode: 0o600,
  });
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    process.stdout.write(`${line}\n`);
    logStream.write(`${line}\n`);
  };

  const startedAt = new Date();
  let manifest = {
    schemaVersion: 1,
    runId,
    status: "running",
    journeyFilters: redactEvidence(extractJourneyFilters(playwrightArguments)),
    target: {
      webUrl: target.webUrl,
      apiUrl: target.apiUrl,
      composeProject: target.composeProject,
      localContentRoot,
    },
    git: {
      commit: git.commit,
      initialDirtyFiles: git.dirtyFiles,
    },
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: null,
    versions: {
      playwright: playwrightPackage.version,
      chromium: null,
    },
    execution: {
      suite,
      headed,
      journeyVideo: headed ? "on" : "retain-on-failure",
    },
    preflight: [],
    exitCode: null,
    cleanup: {
      content: null,
      lockReleased: null,
    },
    artifacts: Object.fromEntries(
      Object.entries({
        runDirectory: artifacts.runDirectory,
        manifest: artifacts.manifest,
        runnerLog: artifacts.runnerLog,
        evidenceDirectory: artifacts.evidenceDirectory,
        htmlReport: artifacts.htmlReport,
        jsonResults: artifacts.jsonResults,
        outputDirectory: artifacts.outputDirectory,
        contentLedger: artifacts.contentLedger,
        cleanupSummary: artifacts.cleanupSummary,
      }).map(([key, value]) => [key, relativeToRepository(value)]),
    ),
  };
  await writePrivateJson(artifacts.manifest, manifest);

  let lockOwner = null;
  let child = null;
  let receivedSignal = null;
  let exitCode = 1;
  const signalHandlers = new Map();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      receivedSignal = signal;
      log(`Received ${signal}; asking Playwright to stop before cleanup.`);
      if (child && !child.killed) {
        child.kill(signal);
      }
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    await assertExecutableExists(chromiumExecutable);
    const { stdout: chromiumVersion } = await execFileAsync(
      chromiumExecutable,
      ["--version"],
      { timeout: 10_000 },
    );
    manifest.versions.chromium = chromiumVersion.trim();

    const acquiredLock = await acquireMainStackLock({
      lockPath,
      runId,
      evidenceDirectory: artifacts.evidenceDirectory,
    });
    lockOwner = acquiredLock.owner;
    if (acquiredLock.recoveredStaleLockPath) {
      log(
        `Recovered a proven-dead same-host lock into ${relativeToRepository(acquiredLock.recoveredStaleLockPath)}.`,
      );
    }
    log(`Acquired the isolated-stack lock for ${runId}.`);

    manifest.preflight = [
      await checkHttpHealth({
        name: "Accountless application",
        url: `${target.webUrl}/health`,
      }),
    ];
    if (pseudoLocale) {
      manifest.preflight.push(
        await checkDevelopmentApplication({
          url: `${target.webUrl}/`,
          buildMode: process.env.ANIMAMA_WEB_BUILD_MODE,
        }),
      );
    }
    await validateLocalContentRoot(localContentRoot, { repositoryRoot });
    manifest.preflight.push({
      name: "Local content root",
      status: "ready",
    });
    log(
      "Isolated application health check passed; runner performs no service lifecycle operations.",
    );

    if (receivedSignal) {
      throw new Error(`Run interrupted by ${receivedSignal} during preflight.`);
    }

    await writePrivateJson(artifacts.manifest, manifest);
    const playwrightCliPath = resolvePackageBinary(
      playwrightPackagePath,
      playwrightPackage,
      "playwright",
    );
    const childEnvironment = {
      ...process.env,
      ANIMAMA_E2E_RUN_ID: runId,
      ANIMAMA_E2E_RUN_DIR: artifacts.runDirectory,
      ANIMAMA_E2E_PLAYWRIGHT_DIR: artifacts.playwrightDirectory,
      ANIMAMA_E2E_EVIDENCE_DIR: artifacts.evidenceDirectory,
      ANIMAMA_E2E_CONTENT_LEDGER: artifacts.contentLedger,
      ANIMAMA_E2E_CLEANUP_SUMMARY: artifacts.cleanupSummary,
      ANIMAMA_E2E_LOCAL_CONTENT_ROOT: localContentRoot,
      ANIMAMA_E2E_REPOSITORY_ROOT: repositoryRoot,
      ANIMAMA_E2E_WEB_URL: target.webUrl,
      ANIMAMA_E2E_API_URL: target.apiUrl,
      ANIMAMA_E2E_HEADED: headed ? "1" : "0",
      ANIMAMA_E2E_SUITE: suite,
    };
    // These runs deliberately use Playwright's colored status reporter.
    // Playwright forces color for its workers, so inheriting NO_COLOR would
    // print one conflict warning per process before any journey result.
    delete childEnvironment.NO_COLOR;
    const childArguments = [
      playwrightCliPath,
      "test",
      "--config",
      playwrightConfigPath,
      ...playwrightArguments,
    ];

    log(
      `Launching Playwright with filters: ${JSON.stringify(manifest.journeyFilters)}.`,
    );
    child = spawn(process.execPath, childArguments, {
      cwd: frontendRoot,
      env: childEnvironment,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      logStream.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });
    const result = await waitForChild(child);
    if (typeof result.code === "number") {
      exitCode = result.code;
    } else {
      exitCode = result.signal === "SIGINT" ? 130 : 143;
    }
    log(`Playwright finished with exit code ${exitCode}.`);
  } catch (error) {
    const safeError = redactEvidence(error);
    manifest.failure = {
      name: safeError.name ?? "Error",
      message: safeError.message ?? "The E2E runner failed.",
    };
    log(`E2E runner failure: ${manifest.failure.message}`);
    exitCode = receivedSignal === "SIGINT" ? 130 : receivedSignal ? 143 : 1;
  } finally {
    try {
      const ledgerEvents = await readContentLedger(artifacts.contentLedger);
      const unresolved = unresolvedContentWork(ledgerEvents);
      let fallback = {
        attempted: 0,
        deleted: 0,
        failed: 0,
        results: [],
        failures: [],
      };
      if (unresolved.length > 0) {
        const catalogClient = await createLocalCatalogClient({
          apiUrl: target.apiUrl,
        });
        try {
          fallback = await cleanupOwnedContent({
            ledgerPath: artifacts.contentLedger,
            catalogClient,
            localRoot: localContentRoot,
            repositoryRoot,
            actor: "runner",
          });
        } finally {
          await catalogClient.close();
        }
      }
      const finalEvents = await readContentLedger(artifacts.contentLedger);
      const remaining = unresolvedContentWork(finalEvents).length;
      const cleanupSummary = {
        status: remaining === 0 ? "complete" : "failed",
        fallback,
        remainingWork: remaining,
        ledger: summarizeContentLedgerLifecycle(finalEvents),
      };
      await writePrivateJson(artifacts.cleanupSummary, cleanupSummary);
      manifest.cleanup.content = cleanupSummary;
      if (remaining > 0) {
        throw new Error(
          `${remaining} owned item(s) or unconfirmed import operation(s) remain.`,
        );
      }
      log(
        fallback.attempted > 0
          ? `Runner cleanup resolved ${fallback.deleted} exact owned creator item(s).`
          : "Creator content ledger has no unresolved content or import operations.",
      );
    } catch (error) {
      const safeError = redactEvidence(error);
      const cleanupDetails =
        error && typeof error === "object" && "summary" in error
          ? redactEvidence(error.summary)
          : null;
      manifest.cleanup.content = {
        status: "failed",
        message: safeError.message,
        summary: cleanupDetails,
      };
      await writePrivateJson(
        artifacts.cleanupSummary,
        manifest.cleanup.content,
      );
      log(`Creator content cleanup failed: ${safeError.message}`);
      exitCode = exitCode || 1;
    }

    if (lockOwner) {
      try {
        manifest.cleanup.lockReleased = await releaseMainStackLock({
          lockPath,
          owner: lockOwner,
        });
        log("Released the isolated-stack lock.");
      } catch (error) {
        manifest.cleanup.lockReleased = false;
        log(
          `Isolated-stack lock release failed: ${redactEvidence(error).message}`,
        );
        exitCode = exitCode || 1;
      }
    } else {
      manifest.cleanup.lockReleased = true;
    }

    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    const endedAt = new Date();
    manifest = {
      ...manifest,
      status: exitCode === 0 ? "passed" : "failed",
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      exitCode,
    };
    await writePrivateJson(artifacts.manifest, manifest);
    await writePrivateJson(path.join(generatedRoot, "latest-run.json"), {
      runId,
      runDirectory: relativeToRepository(runDirectory),
      manifest: relativeToRepository(artifacts.manifest),
      htmlReport: relativeToRepository(artifacts.htmlReport),
    });
    await chmod(runDirectory, 0o700);
    log(`Run evidence: ${relativeToRepository(runDirectory)}`);
    log(`HTML report: ${relativeToRepository(artifacts.htmlReport)}`);
    await new Promise((resolve) => logStream.end(resolve));
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  const safeError = redactEvidence(error);
  process.stderr.write(
    `Playwright E2E runner could not start: ${safeError.message}\n`,
  );
  process.exitCode = 1;
});
