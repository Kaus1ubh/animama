import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REDACTED_VALUE,
  acquireMainStackLock,
  createExclusiveDirectory,
  formatGeneratedId,
  isLoopbackUrl,
  redactEvidence,
  releaseMainStackLock,
  resolvePackageBinary,
  resolveE2eEnvironment,
  resolveE2eLocalContentRoot,
} from "./run-support.mjs";

test("package binaries resolve from the declared manifest path", () => {
  assert.equal(
    resolvePackageBinary(
      "/workspace/node_modules/playwright/package.json",
      { bin: { playwright: "cli.js" } },
      "playwright",
    ),
    "/workspace/node_modules/playwright/cli.js",
  );
  assert.throws(
    () =>
      resolvePackageBinary(
        "/workspace/node_modules/playwright/package.json",
        { bin: { playwright: "../../outside.js" } },
        "playwright",
      ),
    /escapes its package root/,
  );
});

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "animama-e2e-unit-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("generated IDs use Toronto MMDDHHmmss time", () => {
  assert.equal(
    formatGeneratedId("run", new Date("2026-08-25T14:49:32.000Z")),
    "run-0825104932",
  );
  assert.throws(() => formatGeneratedId("Run"), /Invalid generated ID type/);
});

test("exclusive run directories refuse same-second collisions", async () => {
  await withTemporaryDirectory(async (directory) => {
    const runDirectory = path.join(directory, "runs", "run-0825104932");
    await createExclusiveDirectory(runDirectory);
    await assert.rejects(
      createExclusiveDirectory(runDirectory),
      /Refusing to reuse existing E2E run directory/,
    );
  });
});

test("loopback URL checks accept local variants and reject remote targets", () => {
  for (const url of [
    "http://localhost:5173",
    "https://auth.localhost:3000/health",
    "http://127.0.0.1:8000",
    "http://127.42.0.9:8000",
    "http://[::1]:5173",
  ]) {
    assert.equal(isLoopbackUrl(url), true, url);
  }
  for (const url of [
    "https://example.com",
    "http://192.168.1.2:5173",
    "file:///tmp/animama",
    "http://user:password@localhost:5173",
    "not a URL",
  ]) {
    assert.equal(isLoopbackUrl(url), false, url);
  }
});

test("built-in credentials are refused when any configured target is remote", () => {
  assert.throws(
    () =>
      resolveE2eEnvironment({
        FRONTEND_PUBLIC_BASE_URL: "https://app.example.test",
        WEB_PUBLIC_BASE_URL: "http://localhost:3000",
        ANIMAMA_PUBLIC_API_BASE_URL: "http://localhost:8000",
      }),
    /restricted to loopback targets/,
  );

  const explicit = resolveE2eEnvironment({
    ANIMAMA_E2E_WEB_URL: "https://app.example.test",
    ANIMAMA_E2E_AUTH_URL: "https://auth.example.test",
    ANIMAMA_E2E_API_URL: "https://api.example.test",
    ANIMAMA_E2E_EMAIL: "test-user@example.test",
    ANIMAMA_E2E_PASSWORD: "explicit-test-password",
  });
  assert.equal(explicit.usesDefaultCredentials, false);
});

test("Local content root configuration is exact and unambiguous", () => {
  assert.equal(
    resolveE2eLocalContentRoot("/workspace/animama", {}),
    "/workspace/animama/content/local",
  );
  assert.equal(
    resolveE2eLocalContentRoot("/workspace/animama", {
      ANIMAMA_E2E_LOCAL_CONTENT_ROOT: "content/local",
      ANIMAMA_LOCAL_CONTENT_HOST_PATH: "/workspace/animama/content/local",
    }),
    "/workspace/animama/content/local",
  );
  assert.throws(
    () =>
      resolveE2eLocalContentRoot("/workspace/animama", {
        ANIMAMA_E2E_LOCAL_CONTENT_ROOT: "/workspace/animama/content/local",
        ANIMAMA_LOCAL_CONTENT_HOST_PATH: "/workspace/other/content/local",
      }),
    /must match/,
  );
});

test("active and foreign-host locks are never removed", async () => {
  await withTemporaryDirectory(async (directory) => {
    const lockPath = path.join(directory, "locks", "main-stack.lock");
    const evidenceDirectory = path.join(directory, "evidence");
    const activeOwner = {
      runId: "run-active",
      pid: 41,
      host: "test-host",
      acquiredAt: "2026-08-25T12:00:00.000Z",
    };
    await createExclusiveDirectory(path.dirname(lockPath));
    await writeFile(lockPath, JSON.stringify(activeOwner));

    await assert.rejects(
      acquireMainStackLock({
        lockPath,
        runId: "run-next",
        evidenceDirectory,
        hostname: "test-host",
        processAlive: () => true,
      }),
      /lock is active/,
    );
    assert.equal(
      JSON.parse(await readFile(lockPath, "utf8")).runId,
      "run-active",
    );

    await assert.rejects(
      acquireMainStackLock({
        lockPath,
        runId: "run-next",
        evidenceDirectory,
        hostname: "another-host",
        processAlive: () => false,
      }),
      /belongs to host test-host/,
    );
  });
});

test("same-host stale locks are preserved and ownership gates release", async () => {
  await withTemporaryDirectory(async (directory) => {
    const lockPath = path.join(directory, "locks", "main-stack.lock");
    const evidenceDirectory = path.join(directory, "evidence");
    const staleOwner = {
      runId: "run-stale",
      pid: 42,
      host: "test-host",
      acquiredAt: "2026-08-25T12:00:00.000Z",
    };
    await createExclusiveDirectory(path.dirname(lockPath));
    await writeFile(lockPath, `${JSON.stringify(staleOwner)}\n`);

    const acquired = await acquireMainStackLock({
      lockPath,
      runId: "run-next",
      evidenceDirectory,
      pid: 100,
      hostname: "test-host",
      processAlive: () => false,
    });

    assert.equal(acquired.owner.runId, "run-next");
    assert.deepEqual(
      JSON.parse(await readFile(acquired.recoveredStaleLockPath, "utf8")),
      staleOwner,
    );
    await assert.rejects(
      releaseMainStackLock({
        lockPath,
        owner: { ...acquired.owner, runId: "not-the-owner" },
      }),
      /owned by another run/,
    );
    assert.equal(
      await releaseMainStackLock({ lockPath, owner: acquired.owner }),
      true,
    );
  });
});

test("evidence redaction happens recursively and bounds large values", () => {
  const redacted = redactEvidence({
    message:
      "request failed: Bearer abc.def.ghi at /path?token=secret-value&ok=1",
    detail: "password=codex",
    authorization: "Bearer raw-value",
    nested: {
      cookieValue: "session=private",
      safe: "visible",
    },
    long: "x".repeat(9_000),
  });

  assert.equal(redacted.authorization, REDACTED_VALUE);
  assert.equal(redacted.nested.cookieValue, REDACTED_VALUE);
  assert.equal(redacted.nested.safe, "visible");
  assert.match(redacted.message, /Bearer \[REDACTED\]/);
  assert.match(redacted.message, /token=\[REDACTED\]/);
  assert.equal(redacted.detail, "password=[REDACTED]");
  assert.match(redacted.long, /\[truncated\]$/);
  assert.doesNotMatch(
    JSON.stringify(redacted),
    /secret-value|raw-value|private|codex/,
  );
});
