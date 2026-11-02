import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RuntimeError } from "./errors.js";

/** Walk without following links before creating any private state directory. */
export function privateDirectory(directory: string): void {
  const absolute = path.resolve(directory);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new RuntimeError("private_state_path_invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(cursor, { mode: 0o700 });
    }
  }
}

// Antivirus and indexers briefly open new files without delete sharing, and
// Windows then refuses a rename with EPERM, EACCES or EBUSY.
const SHARING_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);
const SHARING_RETRY_MS = [25, 50, 100, 200, 400, 800];

function retryable(error: unknown, delay: number | undefined): boolean {
  return (
    process.platform === "win32" &&
    delay !== undefined &&
    SHARING_ERRORS.has((error as NodeJS.ErrnoException).code ?? "")
  );
}

/** Run a filesystem change, retrying briefly while Windows reports sharing. */
export function retrySharingViolations<T>(
  operation: () => T,
  delays: number[] = SHARING_RETRY_MS,
): T {
  for (const delay of [...delays, undefined]) {
    try {
      return operation();
    } catch (error) {
      if (!retryable(error, delay)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
  throw new Error("unreachable");
}

/** The asynchronous form of {@link retrySharingViolations}. */
export async function retrySharingViolationsAsync<T>(
  operation: () => Promise<T>,
  delays: number[] = SHARING_RETRY_MS,
): Promise<T> {
  for (const delay of [...delays, undefined]) {
    try {
      return await operation();
    } catch (error) {
      if (!retryable(error, delay)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("unreachable");
}

/** POSIX private files are owner-only; Windows protects them by profile ACL. */
export function privateFileMode(stat: Stats): boolean {
  return process.platform === "win32" || (stat.mode & 0o777) === 0o600;
}

/**
 * Make a rename in `directory` durable. Windows cannot flush a directory handle
 * (it reports EPERM); NTFS journals the metadata change instead.
 */
export function syncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  const folder = openSync(directory, "r");
  try {
    fsyncSync(folder);
  } finally {
    closeSync(folder);
  }
}

/**
 * Parse a small JSON state file, or `null` when it is missing, larger than
 * `maxBytes`, not a regular file or not JSON. Links are never followed, so a
 * link planted in place of the file is ignored.
 */
export function readSmallJsonFile(file: string, maxBytes: number): unknown {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Save private state with same-directory promotion and durable directory metadata. */
export function atomicWrite(file: string, data: string | Buffer): void {
  const parent = path.dirname(file);
  privateDirectory(parent);
  const temporary = path.join(
    parent,
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new RuntimeError("private_state_path_invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    retrySharingViolations(() => renameSync(temporary, file));
    syncDirectory(parent);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
