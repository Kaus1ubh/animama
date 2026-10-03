import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicWrite,
  privateDirectory,
} from "../src/main-process/runtime/atomic-file.js";
import {
  MAX_WINDOWS_DATA_ROOT,
  runtimePaths,
} from "../src/main-process/runtime/paths.js";
import { PrivatePostgres } from "../src/main-process/runtime/postgres.js";
import {
  OwnedProcesses,
  runCommand,
  useProcessGuard,
} from "../src/main-process/runtime/processes.js";
import {
  stagedProcessGuard,
  stagedWindowsRuntime as stagedRuntime,
} from "./fixtures/process-guard.js";

const staged =
  existsSync(path.join(stagedRuntime, "postgres/bin/postgres.exe")) &&
  existsSync(stagedProcessGuard);
const roots: string[] = [];
function fixture(name = "animama-windows-storage-"): string {
  const root = mkdtempSync(path.join(tmpdir(), name));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Hold a file open without delete sharing, as antivirus scanners do. Resolves
 * once the lock is held; `released` settles when the holder lets go.
 */
async function holdWithoutDeleteSharing(
  file: string,
  milliseconds: number,
): Promise<{ released: Promise<void> }> {
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$f = [IO.File]::Open($env:ANIMAMA_LOCKED, 'Open', 'Read', 'Read'); 'locked'; Start-Sleep -Milliseconds ${milliseconds}; $f.Close()`,
    ],
    { env: { ...process.env, ANIMAMA_LOCKED: file } },
  );
  const released = new Promise<void>((resolve) =>
    holder.once("exit", () => resolve()),
  );
  await new Promise<void>((resolve, reject) => {
    holder.stdout.once("data", () => resolve());
    holder.once("exit", () => reject(new Error("lock holder exited early")));
  });
  return { released };
}

describe.skipIf(process.platform !== "win32")("Windows private storage", () => {
  it("refuses a junction anywhere in a private state path", () => {
    const root = fixture();
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    // Junctions need no privilege, unlike symbolic links.
    symlinkSync(outside, path.join(root, "profile"), "junction");
    expect(() =>
      privateDirectory(path.join(root, "profile", "runtime")),
    ).toThrow("private_state_path_invalid");
  });

  // PowerShell can take seconds to start, so these tests allow more time.
  it("replaces a file once a scanner releases it", async () => {
    const file = path.join(fixture(), "state.json");
    writeFileSync(file, "old");
    const lock = await holdWithoutDeleteSharing(file, 400);
    atomicWrite(file, "new");
    await lock.released;
    expect(readFileSync(file, "utf8")).toBe("new");
  }, 20_000);

  it("fails clearly and keeps the old file when a lock outlasts the retries", async () => {
    const file = path.join(fixture(), "state.json");
    writeFileSync(file, "old");
    // Longer than the 1575 ms retry window.
    const lock = await holdWithoutDeleteSharing(file, 2500);
    expect(() => atomicWrite(file, "new")).toThrow(/EPERM|EACCES|EBUSY/u);
    await lock.released;
    expect(readFileSync(file, "utf8")).toBe("old");
  }, 20_000);
});

describe.skipIf(process.platform !== "win32" || !staged)(
  "staged Windows runtime",
  () => {
    beforeEach(() => useProcessGuard(stagedProcessGuard));

    it("reports a missing runtime DLL as a damaged runtime file", async () => {
      // pg_isready imports libpq.dll and the VC++ runtime from its own folder.
      const alone = path.join(fixture(), "pg_isready.exe");
      copyFileSync(
        path.join(stagedRuntime, "postgres/bin/pg_isready.exe"),
        alone,
      );
      await expect(
        runCommand(alone, ["--version"], {}, path.dirname(alone)),
      ).rejects.toThrow("runtime_file_invalid");
    });

    it("runs PostgreSQL below a data root with spaces, non-ASCII text and the full length budget", async () => {
      const parent = fixture("A ");
      const name = "Animama データ ";
      const base = path.join(
        parent,
        name.padEnd(MAX_WINDOWS_DATA_ROOT - parent.length - 1, "x"),
      );
      expect(base.length).toBe(MAX_WINDOWS_DATA_ROOT);
      const paths = runtimePaths(base);
      const owned = new OwnedProcesses(paths.processes);
      const postgres = new PrivatePostgres(stagedRuntime, paths, owned);
      try {
        const env = await postgres.start("a".repeat(64));
        await runCommand(postgres.bin("pg_isready"), ["-q"], env, paths.base);
      } finally {
        await postgres.stop();
        await owned.terminateAll();
      }
    }, 120_000);
  },
);
