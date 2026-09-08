import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MigrationBackup } from "../src/main-process/runtime/migrations.js";
import { runtimePaths } from "../src/main-process/runtime/paths.js";
import { runCommand } from "../src/main-process/runtime/processes.js";

vi.mock("../src/main-process/runtime/processes.js", () => ({
  runCommand: vi.fn(),
}));
const roots: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("pre-migration recovery snapshots", () => {
  it("keeps the first verified dump across failed retries and retains earlier recovery snapshots", async () => {
    const root = mkdtempSync(
      path.join(realpathSync(tmpdir()), "animama-migration-"),
    );
    roots.push(root);
    const paths = runtimePaths(root);
    vi.mocked(runCommand).mockImplementation(async (command, args) => {
      if (command === "pg_dump")
        writeFileSync(args[2]!, "fixture custom-format dump");
      return "verified";
    });
    const backup = new MigrationBackup(paths, (name) => name, {});
    await backup.prepare("0010_before", "0011_after");
    const journal = JSON.parse(
      readFileSync(path.join(paths.backups, "migration.json"), "utf8"),
    );
    await backup.prepare("0010_before", "0011_after");
    expect(
      vi.mocked(runCommand).mock.calls.filter((call) => call[0] === "pg_dump"),
    ).toHaveLength(1);
    await expect(backup.prepare("0010_before", "0012_other")).rejects.toThrow(
      "migration_recovery_required",
    );
    expect(existsSync(path.join(paths.backups, journal.backup))).toBe(true);
    backup.complete("0011_after");
    await backup.prepare("0011_after", "0012_other");
    expect(
      readdirSync(paths.backups, { recursive: true }).filter((file) =>
        String(file).endsWith(".dump"),
      ),
    ).toHaveLength(2);
    expect(existsSync(path.join(paths.backups, journal.backup))).toBe(true);
  });

  it("refuses to migrate when dump verification fails and preserves earlier recovery bytes", async () => {
    const root = mkdtempSync(
      path.join(realpathSync(tmpdir()), "animama-migration-"),
    );
    roots.push(root);
    const paths = runtimePaths(root);
    vi.mocked(runCommand).mockImplementation(async (command, args) => {
      if (command === "pg_dump") writeFileSync(args[2]!, "invalid dump");
      else throw new Error("fixture verify failed");
      return "";
    });
    const backup = new MigrationBackup(paths, (name) => name, {});
    await expect(backup.prepare("0010_before", "0011_after")).rejects.toThrow(
      "pre_migration_backup_failed",
    );
    expect(existsSync(path.join(paths.backups, "migration.json"))).toBe(false);
    expect(
      readdirSync(paths.backups, { recursive: true }).some((file) =>
        String(file).endsWith(".partial"),
      ),
    ).toBe(true);
  });

  it("prunes only older successful snapshots after two distinct launches, never a failed upgrade snapshot", async () => {
    const root = mkdtempSync(
      path.join(realpathSync(tmpdir()), "animama-migration-"),
    );
    roots.push(root);
    const paths = runtimePaths(root);
    vi.mocked(runCommand).mockImplementation(async (command, args) => {
      if (command === "pg_dump")
        writeFileSync(args[2]!, "custom-format fixture");
      return "verified";
    });
    const backup = new MigrationBackup(paths, (name) => name, {});
    const record = () =>
      JSON.parse(
        readFileSync(path.join(paths.backups, "migration.json"), "utf8"),
      );
    await backup.prepare("0010_before", "0011_after");
    const successful = record().backup;
    backup.complete("0011_after");
    await backup.prepare("0011_after", "0012_after");
    const failed = record().backup;
    backup.failed();
    backup.complete("0012_after");
    await backup.prepare("0012_after", "0013_after");
    const newest = record().backup;
    backup.complete("0013_after");
    const launch = "11111111-1111-4111-8111-111111111111";
    backup.successfulLaunch("0013_after", launch);
    backup.successfulLaunch("0013_after", launch);
    expect(existsSync(path.join(paths.backups, successful))).toBe(true);
    backup.successfulLaunch(
      "0013_after",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(existsSync(path.join(paths.backups, successful))).toBe(false);
    expect(existsSync(path.join(paths.backups, failed))).toBe(true);
    expect(existsSync(path.join(paths.backups, newest))).toBe(true);
    expect(backup.recoveryLocation()).toBe(`backups/pre-migration/${newest}`);
    expect(newest).toMatch(/^0012_after-to-0013_after\/before-/u);
  });

  it("retains the snapshot when an interrupted upgrade already reached its target schema", async () => {
    const root = mkdtempSync(
      path.join(realpathSync(tmpdir()), "animama-migration-"),
    );
    roots.push(root);
    const paths = runtimePaths(root);
    vi.mocked(runCommand).mockImplementation(async (command, args) => {
      if (command === "pg_dump")
        writeFileSync(args[2]!, "custom-format fixture");
      return "verified";
    });
    await new MigrationBackup(paths, (name) => name, {}).prepare(
      "0010_before",
      "0011_after",
    );
    // On a new app launch SQL may already be at the target, so prepare is skipped.
    new MigrationBackup(paths, (name) => name, {}).complete("0011_after");
    const record = JSON.parse(
      readFileSync(path.join(paths.backups, "migration.json"), "utf8"),
    );
    expect(record.state).toBe("complete");
    expect(record.failed).toBe(true);
    expect(existsSync(path.join(paths.backups, record.backup))).toBe(true);
  });
});
