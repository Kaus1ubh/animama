import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { atomicWrite, privateDirectory, syncDirectory } from "./atomic-file.js";
import { RuntimeError } from "./errors.js";
import { runCommand } from "./processes.js";
import type { RuntimePaths } from "./paths.js";

type Journal = {
  version: 1;
  from: string;
  to: string;
  backup: string;
  state: "prepared" | "complete";
  failed: boolean;
  successfulLaunches: number;
  lastLaunchId: string | null;
};

/** Keep the original pre-upgrade snapshot across retries of a failed migration. */
export class MigrationBackup {
  private journal: string;
  private interrupted: boolean;
  constructor(
    private paths: RuntimePaths,
    private bin: (name: string) => string,
    private env: NodeJS.ProcessEnv,
  ) {
    this.journal = path.join(paths.backups, "migration.json");
    this.interrupted = this.read()?.state === "prepared";
  }
  private read(file = this.journal): Journal | null {
    if (!existsSync(file)) return null;
    try {
      const stat = lstatSync(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 4096
      )
        throw new Error();
      const value = JSON.parse(readFileSync(file, "utf8")) as Journal;
      if (
        value.version !== 1 ||
        typeof value.from !== "string" ||
        typeof value.to !== "string" ||
        typeof value.backup !== "string" ||
        !/^[\w-]{1,128}$/u.test(value.from) ||
        !/^[\w-]{1,128}$/u.test(value.to) ||
        !new RegExp(
          `^(?:${value.from}-to-${value.to}/)?before-[0-9]{1,16}-[a-f0-9]{8}\\.dump$`,
          "u",
        ).test(value.backup) ||
        !["prepared", "complete"].includes(value.state)
      )
        throw new Error();
      // Accept flat backup filenames and initialize missing retention fields without moving dumps.
      value.failed ??= value.state === "prepared";
      value.successfulLaunches ??= 0;
      value.lastLaunchId ??= null;
      if (
        typeof value.failed !== "boolean" ||
        !Number.isInteger(value.successfulLaunches) ||
        value.successfulLaunches < 0 ||
        value.successfulLaunches > 2 ||
        (value.lastLaunchId !== null &&
          !/^[a-f0-9-]{36}$/u.test(value.lastLaunchId))
      )
        throw new Error();
      return value;
    } catch {
      throw new RuntimeError("migration_journal_invalid");
    }
  }
  private write(value: Journal): void {
    // Per-snapshot metadata survives the active journal advancing to another upgrade.
    atomicWrite(
      path.join(this.paths.backups, `${value.backup}.json`),
      JSON.stringify(value),
    );
    atomicWrite(this.journal, JSON.stringify(value));
  }
  /** A relative, fixed-root locator is enough for recovery UI; no arbitrary host path crosses IPC. */
  recoveryLocation(): string | undefined {
    const record = this.read();
    return record ? `backups/pre-migration/${record.backup}` : undefined;
  }
  async prepare(from: string, to: string): Promise<void> {
    if (
      !/^[\w-]{1,128}$/u.test(from) ||
      !/^[\w-]{1,128}$/u.test(to) ||
      from === to
    )
      throw new RuntimeError("migration_journal_invalid");
    const previous = this.read();
    if (previous?.state === "prepared") {
      if (previous.to !== to || previous.from !== from)
        throw new RuntimeError("migration_recovery_required");
      await this.verify(path.join(this.paths.backups, previous.backup));
      this.write({ ...previous, failed: true });
      return;
    }
    const backup = `${from}-to-${to}/before-${Date.now()}-${randomBytes(4).toString("hex")}.dump`;
    const destination = path.join(this.paths.backups, backup);
    const partial = destination + ".partial";
    try {
      atomicWrite(partial, ""); // pg_dump keeps this restricted mode while writing.
      await runCommand(
        this.bin("pg_dump"),
        ["--format=custom", "--file", partial],
        this.env,
        this.paths.base,
      );
      await this.verify(partial);
      const fd = openSync(partial, "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(partial, destination);
      syncDirectory(path.dirname(destination));
      this.write({
        version: 1,
        from,
        to,
        backup,
        state: "prepared",
        failed: false,
        successfulLaunches: 0,
        lastLaunchId: null,
      });
    } catch {
      throw new RuntimeError("pre_migration_backup_failed");
    }
  }
  /** Once a migration fails, its original dump is retained even if a later retry succeeds. */
  failed(): void {
    const journal = this.read();
    if (journal?.state === "prepared") this.write({ ...journal, failed: true });
  }
  private async verify(file: string): Promise<void> {
    try {
      const stat = lstatSync(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size < 1 ||
        (stat.mode & 0o777) !== 0o600
      )
        throw new Error();
      await runCommand(
        this.bin("pg_restore"),
        ["--list", file],
        this.env,
        this.paths.base,
      );
    } catch {
      throw new RuntimeError("pre_migration_backup_failed");
    }
  }
  complete(head: string): void {
    const journal = this.read();
    if (journal?.state === "prepared") {
      if (journal.to !== head)
        throw new RuntimeError("migration_recovery_required");
      this.write({
        ...journal,
        state: "complete",
        failed: journal.failed || this.interrupted,
      });
    }
  }
  /** Count actual app launches, not provider restarts or repeated Retry clicks. */
  successfulLaunch(head: string, launchId: string): void {
    const journal = this.read();
    if (
      !journal ||
      journal.state !== "complete" ||
      journal.to !== head ||
      journal.lastLaunchId === launchId
    )
      return;
    const current = {
      ...journal,
      successfulLaunches: Math.min(2, journal.successfulLaunches + 1),
      lastLaunchId: launchId,
    };
    this.write(current);
    if (current.successfulLaunches < 2) return;
    // Pruning is optional. Unknown entries, symlinks, failed/prepared dumps and
    // the newest verified snapshot are always retained, including on IO failure.
    try {
      privateDirectory(this.paths.backups);
      let examined = 0;
      for (const entry of readdirSync(this.paths.backups, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory() || !/^[\w-]+-to-[\w-]+$/u.test(entry.name))
          continue;
        const folder = path.join(this.paths.backups, entry.name);
        privateDirectory(folder);
        for (const file of readdirSync(folder)) {
          if (++examined > 2048) return;
          if (!/^before-\d+-[a-f0-9]{8}\.dump\.json$/u.test(file)) continue;
          const metadataPath = path.join(folder, file);
          const record = this.read(metadataPath);
          if (
            !record ||
            record.backup === current.backup ||
            record.state !== "complete" ||
            record.failed ||
            path.join(this.paths.backups, `${record.backup}.json`) !==
              metadataPath
          )
            continue;
          const dump = path.join(this.paths.backups, record.backup);
          const metadata = lstatSync(dump);
          if (
            !metadata.isFile() ||
            metadata.isSymbolicLink() ||
            metadata.nlink !== 1
          )
            continue;
          rmSync(dump);
          rmSync(metadataPath);
        }
      }
    } catch {
      /* Retention failure never resets data or removes a less certain snapshot. */
    }
  }
}
