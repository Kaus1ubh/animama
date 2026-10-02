import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite, privateDirectory } from "./atomic-file.js";
import { RuntimeError } from "./errors.js";
import { runtimeRedactor } from "./redaction.js";
import { writeLog } from "../logging.js";

export type OwnedProcess = {
  name: string;
  child: ChildProcess;
  token: string;
  executable: string;
  dataRoot: string;
  output: string;
  exit: Promise<void>;
};

/**
 * Inherit OS locale, home and temporary folders only; never leak unrelated
 * developer credentials to children. Windows children also need SystemRoot
 * (Winsock fails without it) and a PATH limited to the system folders.
 */
export function baseChildEnvironment(
  platform: NodeJS.Platform = process.platform,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const windows = platform === "win32";
  const systemRoot = source.SystemRoot || "C:\\Windows";
  const env: NodeJS.ProcessEnv = {
    PATH: windows
      ? [`${systemRoot}\\System32`, systemRoot].join(";")
      : "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  const keys = windows
    ? [
        "SystemRoot",
        "SystemDrive",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "LOCALAPPDATA",
      ]
    : ["HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "USER", "LOGNAME"];
  for (const key of keys) if (source[key]) env[key] = source[key];
  return env;
}

function logLines(child: ChildProcess, owned: OwnedProcess): void {
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    let discarding = false;
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      pending += chunk;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!discarding) {
          const safe = runtimeRedactor.redact(line);
          owned.output = (owned.output + safe + "\n").slice(-8192);
          writeLog("info", `[${owned.name}] ${safe}`);
        }
        discarding = false;
      }
      // Never emit a partial oversized line: it could split a secret value.
      if (pending.length > 64 * 1024) {
        pending = "";
        discarding = true;
      }
    });
    stream?.on("end", () => {
      if (pending && !discarding)
        writeLog("info", `[${owned.name}] ${runtimeRedactor.redact(pending)}`);
    });
  }
}

/** Track exact handles. A stale persisted PID is evidence, never kill authority. */
export class OwnedProcesses {
  readonly children = new Set<OwnedProcess>();
  constructor(private recordFile: string) {
    privateDirectory(path.dirname(recordFile));
    if (!existsSync(recordFile)) return;
    try {
      const stat = lstatSync(recordFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768)
        throw new Error();
      const record = JSON.parse(readFileSync(recordFile, "utf8"));
      if (record.version !== 1 || !Array.isArray(record.children))
        throw new Error();
      for (const item of record.children) {
        if (!Number.isInteger(item.pid) || item.pid < 1) throw new Error();
        try {
          process.kill(item.pid, 0);
          throw new RuntimeError("previous_runtime_running");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("process_ownership_record_invalid");
    }
  }
  private persist(): void {
    atomicWrite(
      this.recordFile,
      JSON.stringify({
        version: 1,
        children: [...this.children]
          .filter((item) => item.child.pid)
          .map((item) => ({
            name: item.name,
            pid: item.child.pid,
            startToken: item.token,
            executable: item.executable,
            dataRoot: item.dataRoot,
          })),
      }),
    );
  }
  launch(
    name: string,
    executable: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
  ): OwnedProcess {
    const token = randomUUID();
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...baseChildEnvironment(),
        ...env,
        ANIMAMA_PROCESS_START_TOKEN: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const item: OwnedProcess = {
      name,
      child,
      token,
      executable,
      dataRoot: cwd,
      output: "",
      exit: Promise.resolve(),
    };
    item.exit = new Promise((resolve) => {
      const finished = () => {
        this.children.delete(item);
        try {
          this.persist();
        } catch {
          writeLog("error", "process_ownership_record_write_failed");
        } finally {
          resolve();
        }
      };
      child.once("exit", finished);
      child.once("error", finished);
    });
    this.children.add(item);
    this.persist();
    logLines(child, item);
    return item;
  }
  async terminate(item: OwnedProcess, timeoutMs = 15_000): Promise<void> {
    if (!this.children.has(item)) return;
    item.child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = await Promise.race([
      item.exit.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (expired && this.children.has(item)) {
      writeLog(
        "error",
        `Owned ${item.name} exceeded its shutdown deadline; terminating the retained handle`,
      );
      item.child.kill("SIGKILL");
      await item.exit;
    }
  }
  async terminateAll(): Promise<void> {
    for (const item of [...this.children].reverse()) await this.terminate(item);
  }
}

/** Bounded command output is internal to main; arguments never contain secrets. */
export async function runCommand(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs = 120_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...baseChildEnvironment(), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure: string | undefined;
    const timer = setTimeout(() => {
      failure = "runtime_command_timeout";
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      if (failure) return;
      stdout += data;
      if (stdout.length > 1024 * 1024) {
        failure = "runtime_command_output_limit";
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (data: string) => {
      if (failure) return;
      stderr += data;
      if (stderr.length > 1024 * 1024) {
        failure = "runtime_command_output_limit";
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new RuntimeError("runtime_command_failed"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || failure) {
        writeLog("error", runtimeRedactor.redact(stderr).slice(-8192));
        reject(new RuntimeError(failure ?? "runtime_command_failed"));
      } else resolve(stdout);
    });
  });
}
