import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

const E2E_TIME_ZONE = "America/Toronto";
const DEFAULT_WEB_URL = "http://localhost:5173";
const DEFAULT_AUTH_URL = "http://localhost:3000";
const DEFAULT_API_URL = "http://localhost:8000";
const DEFAULT_E2E_EMAIL = "codex@local.test";
const DEFAULT_E2E_PASSWORD = "codex";
export const REDACTED_VALUE = "[REDACTED]";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_EVIDENCE_STRING_LENGTH = 8_192;
const MAX_EVIDENCE_ARRAY_LENGTH = 100;
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|passwd|secret|token|api.?key|session)/i;

/** Resolve a package-declared binary without relying on private export paths. */
export function resolvePackageBinary(
  packageJsonPath,
  packageManifest,
  binaryName,
) {
  const binary =
    typeof packageManifest?.bin === "string"
      ? packageManifest.bin
      : packageManifest?.bin?.[binaryName];
  if (typeof binary !== "string" || !binary.trim()) {
    throw new Error(`Package does not declare the ${binaryName} binary.`);
  }
  const packageRoot = path.dirname(path.resolve(packageJsonPath));
  const resolved = path.resolve(packageRoot, binary);
  const relative = path.relative(packageRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Package ${binaryName} binary escapes its package root.`);
  }
  return resolved;
}

/** Generate the simple, second-precision ID shape selected by the ExecPlan. */
export function formatGeneratedId(type, date = new Date()) {
  if (!/^[a-z][a-z0-9-]*$/.test(type)) {
    throw new Error(`Invalid generated ID type: ${type}`);
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: E2E_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${type}-${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/** Create a run directory without ever reusing an existing second-precision ID. */
export async function createExclusiveDirectory(directoryPath) {
  await mkdir(path.dirname(directoryPath), {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });

  try {
    await mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Refusing to reuse existing E2E run directory: ${directoryPath}. Retry after the current second.`,
      );
    }
    throw error;
  }
}

/** Ensure generated directories stay private even if they existed already. */
export async function ensurePrivateDirectory(directoryPath) {
  await mkdir(directoryPath, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  await chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
}

/** Return true only for HTTP(S) loopback hosts, including `.localhost`. */
export function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    if (url.username || url.password) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "[::1]"
    ) {
      return true;
    }

    const ipv4Parts = hostname.split(".");
    return (
      ipv4Parts.length === 4 &&
      ipv4Parts.every(
        (part) => /^\d{1,3}$/.test(part) && Number(part) <= 255,
      ) &&
      Number(ipv4Parts[0]) === 127
    );
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      `${label} must be an HTTP(S) URL without embedded credentials.`,
    );
  }
  return url.toString().replace(/\/$/, "");
}

/** Resolve the external stack target and enforce the loopback default-user rule. */
export function resolveE2eEnvironment(environment = process.env) {
  const webUrl = normalizeBaseUrl(
    environment.ANIMAMA_E2E_WEB_URL ??
      environment.FRONTEND_PUBLIC_BASE_URL ??
      DEFAULT_WEB_URL,
    "Animama web URL",
  );
  const authUrl = normalizeBaseUrl(
    environment.ANIMAMA_E2E_AUTH_URL ??
      environment.WEB_PUBLIC_BASE_URL ??
      DEFAULT_AUTH_URL,
    "Animama auth URL",
  );
  const apiUrl = normalizeBaseUrl(
    environment.ANIMAMA_E2E_API_URL ??
      environment.ANIMAMA_PUBLIC_API_BASE_URL ??
      DEFAULT_API_URL,
    "Animama API URL",
  );

  const hasExplicitEmail = Boolean(environment.ANIMAMA_E2E_EMAIL?.trim());
  const hasExplicitPassword = Boolean(environment.ANIMAMA_E2E_PASSWORD);
  if (hasExplicitEmail !== hasExplicitPassword) {
    throw new Error(
      "Set both ANIMAMA_E2E_EMAIL and ANIMAMA_E2E_PASSWORD, or set neither.",
    );
  }

  const usesDefaultCredentials = !hasExplicitEmail;
  const targetUrls = [webUrl, authUrl, apiUrl];
  if (usesDefaultCredentials && !targetUrls.every(isLoopbackUrl)) {
    throw new Error(
      "Built-in Codex E2E credentials are restricted to loopback targets. Set explicit ANIMAMA_E2E_EMAIL and ANIMAMA_E2E_PASSWORD for another environment.",
    );
  }

  return {
    webUrl,
    authUrl,
    apiUrl,
    composeProject:
      environment.ANIMAMA_E2E_COMPOSE_PROJECT ??
      environment.COMPOSE_PROJECT_NAME ??
      "animama",
    email: usesDefaultCredentials
      ? DEFAULT_E2E_EMAIL
      : environment.ANIMAMA_E2E_EMAIL.trim(),
    password: usesDefaultCredentials
      ? DEFAULT_E2E_PASSWORD
      : environment.ANIMAMA_E2E_PASSWORD,
    usesDefaultCredentials,
  };
}

/** Resolve the host-mounted Local content root without inspecting its files. */
export function resolveE2eLocalContentRoot(
  repositoryRoot,
  environment = process.env,
) {
  const resolveConfiguredRoot = (value) =>
    path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(repositoryRoot, value);
  const explicit = environment.ANIMAMA_E2E_LOCAL_CONTENT_ROOT;
  const stackMount = environment.ANIMAMA_LOCAL_CONTENT_HOST_PATH;
  if (
    explicit &&
    stackMount &&
    resolveConfiguredRoot(explicit) !== resolveConfiguredRoot(stackMount)
  ) {
    throw new Error(
      "ANIMAMA_E2E_LOCAL_CONTENT_ROOT must match ANIMAMA_LOCAL_CONTENT_HOST_PATH.",
    );
  }
  return resolveConfiguredRoot(explicit ?? stackMount ?? "content/local");
}

function redactString(value) {
  const redacted = value
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED_VALUE}`)
    .replace(
      /\b(authorization|cookie|password|passwd|secret|session|token|api[-_ ]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;\s]+)/gi,
      `$1$2${REDACTED_VALUE}`,
    )
    .replace(
      /([?&](?:access_token|auth|authorization|password|secret|session|token)=)[^&#\s]*/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      REDACTED_VALUE,
    );

  if (redacted.length <= MAX_EVIDENCE_STRING_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_EVIDENCE_STRING_LENGTH)}…[truncated]`;
}

/** Deep-copy evidence into a bounded, JSON-safe form before any disk write. */
export function redactEvidence(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value instanceof Error) {
    return {
      name: redactString(value.name),
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (typeof value !== "object") {
    return redactString(String(value));
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const redacted = value
      .slice(0, MAX_EVIDENCE_ARRAY_LENGTH)
      .map((item) => redactEvidence(item, seen));
    if (value.length > MAX_EVIDENCE_ARRAY_LENGTH) {
      redacted.push(
        `[${value.length - MAX_EVIDENCE_ARRAY_LENGTH} items truncated]`,
      );
    }
    return redacted;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED_VALUE
        : redactEvidence(entry, seen),
    ]),
  );
}

/** Append one already-redacted evidence event to a private JSONL file. */
export async function appendEvidenceJsonLine(filePath, value) {
  await ensurePrivateDirectory(path.dirname(filePath));
  const handle = await open(filePath, "a", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(redactEvidence(value))}\n`);
    await handle.chmod(PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

/** Atomically replace a private JSON file so partial manifests are never read. */
export async function writePrivateJson(filePath, value) {
  await ensurePrivateDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: PRIVATE_FILE_MODE,
  });
  await rename(temporaryPath, filePath);
  await chmod(filePath, PRIVATE_FILE_MODE);
}

/** Probe a PID without sending it a signal that changes process state. */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function parseLockOwner(rawLock) {
  let owner;
  try {
    owner = JSON.parse(rawLock);
  } catch {
    throw new Error(
      "The main-stack E2E lock is invalid; ownership is ambiguous.",
    );
  }
  if (
    typeof owner?.runId !== "string" ||
    !Number.isInteger(owner?.pid) ||
    owner.pid <= 0 ||
    typeof owner?.host !== "string" ||
    typeof owner?.acquiredAt !== "string"
  ) {
    throw new Error(
      "The main-stack E2E lock is incomplete; ownership is ambiguous.",
    );
  }
  return owner;
}

async function createLock(lockPath, owner) {
  const handle = await open(lockPath, "wx", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`);
    await handle.chmod(PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

/**
 * Acquire the main-stack lease. Only a same-host lock whose PID is proven dead
 * may be moved aside; active and ambiguous locks are never removed or killed.
 */
export async function acquireMainStackLock({
  lockPath,
  runId,
  evidenceDirectory,
  pid = process.pid,
  hostname = os.hostname(),
  processAlive = isProcessAlive,
  now = new Date(),
}) {
  await ensurePrivateDirectory(path.dirname(lockPath));
  await ensurePrivateDirectory(evidenceDirectory);

  const owner = {
    runId,
    pid,
    host: hostname,
    acquiredAt: now.toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await createLock(lockPath, owner);
      return { owner, recoveredStaleLockPath: null };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    let rawExistingLock;
    try {
      rawExistingLock = await readFile(lockPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const existingOwner = parseLockOwner(rawExistingLock);
    if (existingOwner.host !== hostname) {
      throw new Error(
        `The main-stack E2E lock belongs to host ${existingOwner.host}; refusing ambiguous cleanup.`,
      );
    }
    if (await processAlive(existingOwner.pid)) {
      throw new Error(
        `The main-stack E2E lock is active for ${existingOwner.runId} (PID ${existingOwner.pid}).`,
      );
    }

    const staleLockPath = path.join(
      evidenceDirectory,
      "stale-main-stack-lock.json",
    );
    try {
      await rename(lockPath, staleLockPath);
      await chmod(staleLockPath, PRIVATE_FILE_MODE);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    try {
      await createLock(lockPath, owner);
      return { owner, recoveredStaleLockPath: staleLockPath };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      throw new Error(
        "Another run acquired the main-stack E2E lock during stale-lock recovery.",
      );
    }
  }

  throw new Error("The main-stack E2E lock changed repeatedly; retry the run.");
}

/** Release only the lock that this run still owns. */
export async function releaseMainStackLock({ lockPath, owner }) {
  let rawLock;
  try {
    rawLock = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const currentOwner = parseLockOwner(rawLock);
  if (
    currentOwner.runId !== owner.runId ||
    currentOwner.pid !== owner.pid ||
    currentOwner.host !== owner.host
  ) {
    throw new Error(
      "Refusing to release a main-stack E2E lock now owned by another run.",
    );
  }
  await unlink(lockPath);
  return true;
}

/** Return only the safe journey-selection parts of a Playwright invocation. */
export function extractJourneyFilters(argumentsList) {
  const filters = [];
  const valueFlags = new Set([
    "--grep",
    "--grep-invert",
    "--project",
    "--repeat-each",
    "--shard",
  ]);

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["--headed", "--list"].includes(argument)) {
      filters.push(argument);
      continue;
    }
    const equalsFlag = [...valueFlags].find((flag) =>
      argument.startsWith(`${flag}=`),
    );
    if (equalsFlag) {
      filters.push(argument);
      continue;
    }
    if (valueFlags.has(argument)) {
      const value = argumentsList[index + 1];
      if (value !== undefined) {
        filters.push(argument, value);
        index += 1;
      }
      continue;
    }
    if (!argument.startsWith("-")) {
      filters.push(argument);
    }
  }
  return filters;
}

/** Gather commit and dirty path names without reading or recording file bodies. */
export async function readGitMetadata(repositoryRoot) {
  const [{ stdout: commit }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: repositoryRoot },
    ),
  ]);

  const entries = status.split("\0").filter(Boolean);
  const dirtyFiles = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const statusCode = entry.slice(0, 2);
    dirtyFiles.push(entry.slice(3));
    if (/[RC]/.test(statusCode) && entries[index + 1]) {
      dirtyFiles.push(entries[index + 1]);
      index += 1;
    }
  }

  return {
    commit: commit.trim(),
    dirtyFiles: [...new Set(dirtyFiles)].sort(),
  };
}

/** Check one external service without retaining response bodies or headers. */
export async function checkHttpHealth({ name, url, timeoutMs = 10_000 }) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`${name} preflight failed at ${url}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(
      `${name} preflight returned HTTP ${response.status} at ${url}.`,
    );
  }
  return {
    name,
    url,
    status: response.status,
    durationMs: Date.now() - startedAt,
  };
}

/** Verify the Playwright-managed Chromium executable without downloading it. */
export async function assertExecutableExists(executablePath) {
  try {
    await access(executablePath, fsConstants.X_OK);
  } catch {
    throw new Error(
      `Playwright Chromium is not installed at ${executablePath}. Run: pnpm e2e:install`,
    );
  }
}
