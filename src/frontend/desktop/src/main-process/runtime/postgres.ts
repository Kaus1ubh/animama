import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { atomicWrite, privateDirectory } from "./atomic-file.js";
import { RuntimeError } from "./errors.js";
import { runtimePlatform } from "./manifest.js";
import type { RuntimePaths } from "./paths.js";
import { unusedLoopbackPort } from "./ports.js";
import { OwnedProcesses, type OwnedProcess, runCommand } from "./processes.js";

/**
 * postmaster.pid starts with the postmaster PID, its data directory (written
 * with forward slashes on Windows), start time and port.
 */
export function postmasterRecordMatches(
  record: string,
  pid: number | undefined,
  dataDir: string,
  port: number | undefined,
): boolean {
  const [recordPid, recordDir, , recordPort] = record.split("\n");
  return (
    Number(recordPid) === pid &&
    Boolean(recordDir) &&
    path.resolve(recordDir) === path.resolve(dataDir) &&
    Number(recordPort) === port
  );
}

/**
 * The OS error text is localized on Windows. PostgreSQL adds this hint only
 * for an occupied port, in English because NLS is disabled in the bundled build.
 */
export function reportsPortCollision(output: string): boolean {
  return /Is another postmaster already running on port/u.test(output);
}

export class PrivatePostgres {
  process?: OwnedProcess;
  port = 0;
  private env: NodeJS.ProcessEnv = {};
  constructor(
    private runtime: string,
    private paths: RuntimePaths,
    private owned: OwnedProcesses,
  ) {}
  bin(name: string): string {
    return path.join(
      this.runtime,
      "postgres/bin",
      `${name}${runtimePlatform(process.platform).executableSuffix}`,
    );
  }
  private postmasterMatches(owned: OwnedProcess): boolean {
    try {
      const file = path.join(this.paths.pgData, "postmaster.pid");
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
        return false;
      return (
        this.owned.children.has(owned) &&
        postmasterRecordMatches(
          readFileSync(file, "utf8"),
          owned.child.pid,
          this.paths.pgData,
          this.port,
        )
      );
    } catch {
      return false;
    }
  }
  async start(password: string): Promise<NodeJS.ProcessEnv> {
    privateDirectory(path.dirname(this.paths.pgData));
    if (existsSync(this.paths.pgData)) privateDirectory(this.paths.pgData);
    if (!existsSync(this.paths.pgData)) {
      const pending = mkdtempSync(
        path.join(path.dirname(this.paths.pgData), ".initializing-"),
      );
      const passwordFile = path.join(
        path.dirname(this.paths.pgData),
        ".init-password",
      );
      try {
        atomicWrite(passwordFile, password + "\n");
        await runCommand(
          this.bin("initdb"),
          [
            "-D",
            pending,
            "-U",
            "animama",
            "--encoding=UTF8",
            "--no-locale",
            "--data-checksums",
            "--auth=scram-sha-256",
            `--pwfile=${passwordFile}`,
          ],
          {},
          this.paths.base,
        );
        renameSync(pending, this.paths.pgData);
      } finally {
        rmSync(passwordFile, { force: true });
        // Only this attempt's never-published initialization directory is disposable.
        rmSync(pending, { recursive: true, force: true });
      }
    }
    let major: string;
    try {
      major = readFileSync(
        path.join(this.paths.pgData, "PG_VERSION"),
        "utf8",
      ).trim();
    } catch {
      throw new RuntimeError("database_initialization_incomplete");
    }
    if (major !== "16") throw new RuntimeError("unsupported_postgresql_major");
    for (let attempt = 0; attempt < 8; attempt++) {
      this.port = await unusedLoopbackPort();
      this.env = {
        PGHOST: "127.0.0.1",
        PGPORT: String(this.port),
        PGUSER: "animama",
        PGDATABASE: "animama",
        PGPASSWORD: password,
        PGSSLMODE: "disable",
      };
      const process = this.owned.launch(
        "postgres",
        this.bin("postgres"),
        [
          "-D",
          this.paths.pgData,
          "-h",
          "127.0.0.1",
          "-p",
          String(this.port),
          // Every child uses SCRAM-authenticated loopback TCP. An unused Unix
          // socket makes long user-data paths fail macOS's 103-byte limit.
          "-c",
          "unix_socket_directories=",
          "-c",
          "log_statement=none",
        ],
        this.env,
        this.paths.base,
      );
      this.process = process;
      const deadline = Date.now() + 30_000;
      while (this.owned.children.has(process) && Date.now() < deadline) {
        try {
          await runCommand(
            this.bin("pg_isready"),
            ["-q"],
            this.env,
            this.paths.base,
            2000,
          );
          if (!this.postmasterMatches(process))
            throw new RuntimeError("postgres_readiness_mismatch");
          return this.env;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      const collision = reportsPortCollision(process.output);
      await this.owned.terminate(process);
      if (!collision) throw new RuntimeError("postgres_start_failed");
    }
    throw new RuntimeError("internal_port_unavailable");
  }
  async stop(): Promise<void> {
    const owned = this.process;
    if (!owned || !this.owned.children.has(owned)) return;
    try {
      if (!this.postmasterMatches(owned))
        throw new RuntimeError("postgres_ownership_mismatch");
      await runCommand(
        this.bin("pg_ctl"),
        ["-D", this.paths.pgData, "-m", "fast", "-w", "-t", "15", "stop"],
        this.env,
        this.paths.base,
        20_000,
      );
    } finally {
      await this.owned.terminate(owned);
      this.process = undefined;
    }
  }
}
