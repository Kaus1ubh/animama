#!/usr/bin/env node

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { cleanupOwnedContent } from "./e2e/content-cleanup.mjs";
import {
  cleanupDryRunEntries,
  parseCleanupArguments,
} from "./e2e/cleanup-command.mjs";
import { readContentLedger } from "./e2e/content-ledger.mjs";
import { createLocalCatalogClient } from "./e2e/local-catalog-client.mjs";
import { validateLocalContentRoot } from "./e2e/local-content-verifier.mjs";
import {
  acquireMainStackLock,
  ensurePrivateDirectory,
  isLoopbackUrl,
  redactEvidence,
  releaseMainStackLock,
  resolveE2eEnvironment,
  resolveE2eLocalContentRoot,
  writePrivateJson,
} from "./e2e/run-support.mjs";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(frontendRoot, "../..");
const generatedRoot = path.join(repositoryRoot, ".animama-e2e");
const lockPath = path.join(generatedRoot, "locks", "main-stack.lock");

async function authenticateViaUi(target, storageStatePath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(target.webUrl, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email", { exact: true }).fill(target.email);
    await page.getByLabel("Password", { exact: true }).fill(target.password);
    await page.getByRole("button", { name: /^Sign In$/i }).click();
    await page.waitForURL(
      (url) => url.pathname === "/a" || url.pathname.startsWith("/a/"),
      { timeout: 30_000 },
    );
    await context.storageState({ path: storageStatePath });
    await chmod(storageStatePath, 0o600);
  } finally {
    await browser.close();
  }
}

async function main() {
  process.umask(0o077);
  const { runId, confirmed } = parseCleanupArguments(process.argv.slice(2));
  const runDirectory = path.join(generatedRoot, "runs", runId);
  if (path.dirname(runDirectory) !== path.join(generatedRoot, "runs")) {
    throw new Error("Cleanup run path escaped the generated runs directory.");
  }
  const ledgerPath = path.join(runDirectory, "content-ledger.jsonl");
  const manifest = JSON.parse(
    await readFile(path.join(runDirectory, "manifest.json"), "utf8"),
  );
  if (manifest.runId !== runId) {
    throw new Error("Run manifest identity does not match the requested run.");
  }
  const evidenceDirectory = path.join(runDirectory, "evidence");
  await ensurePrivateDirectory(evidenceDirectory);
  const acquired = await acquireMainStackLock({
    lockPath,
    runId: `${runId}-cleanup`,
    evidenceDirectory,
  });
  let authDirectory = null;
  try {
    await readFile(ledgerPath, "utf8");
    const events = await readContentLedger(ledgerPath);
    const entries = cleanupDryRunEntries(events);
    process.stdout.write(
      `${JSON.stringify({ runId, confirmed, owned: entries }, null, 2)}\n`,
    );
    if (!confirmed || entries.length === 0) return;
    const target = resolveE2eEnvironment();
    if (
      !isLoopbackUrl(target.webUrl) ||
      !isLoopbackUrl(target.authUrl) ||
      !isLoopbackUrl(target.apiUrl)
    ) {
      throw new Error("Creator cleanup refuses non-loopback targets.");
    }
    for (const key of ["webUrl", "authUrl", "apiUrl"]) {
      if (manifest.target?.[key] !== target[key]) {
        throw new Error(
          "Current cleanup environment does not match the recorded run target.",
        );
      }
    }
    const localRoot = resolveE2eLocalContentRoot(repositoryRoot);
    await validateLocalContentRoot(localRoot, { repositoryRoot });
    authDirectory = await mkdtemp(
      path.join(os.tmpdir(), `${runId}-cleanup-auth-`),
    );
    await chmod(authDirectory, 0o700);
    const storageStatePath = path.join(authDirectory, "storage-state.json");
    await authenticateViaUi(target, storageStatePath);
    const client = await createLocalCatalogClient({
      authUrl: target.authUrl,
      apiUrl: target.apiUrl,
      storageStatePath,
    });
    try {
      try {
        const summary = await cleanupOwnedContent({
          ledgerPath,
          catalogClient: client,
          localRoot,
          repositoryRoot,
          actor: "recovery",
        });
        await writePrivateJson(
          path.join(runDirectory, "cleanup-summary.json"),
          {
            status: "complete",
            recovery: summary,
          },
        );
        process.stdout.write(
          `Recovered ${summary.deleted} exact ledger-owned item(s) for ${runId}.\n`,
        );
      } catch (error) {
        const safeError = redactEvidence(error);
        const cleanupDetails =
          error && typeof error === "object" && "summary" in error
            ? redactEvidence(error.summary)
            : null;
        await writePrivateJson(
          path.join(runDirectory, "cleanup-summary.json"),
          {
            status: "failed",
            message: safeError.message,
            recovery: cleanupDetails,
          },
        );
        throw error;
      }
    } finally {
      await client.close();
    }
  } finally {
    if (authDirectory) {
      await rm(authDirectory, { recursive: true, force: true });
    }
    await releaseMainStackLock({ lockPath, owner: acquired.owner });
  }
}

main().catch((error) => {
  process.stderr.write(
    `Creator cleanup failed: ${redactEvidence(error).message}\n`,
  );
  process.exitCode = 1;
});
