import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  guardHandshake,
  OwnedProcesses,
  runCommand,
  useProcessGuard,
} from "../src/main-process/runtime/processes.js";
import { stagedProcessGuard } from "./fixtures/process-guard.js";

const guard = stagedProcessGuard;
const roots: string[] = [];
const started: ChildProcess[] = [];
afterEach(() => {
  for (const child of started.splice(0)) child.kill();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  useProcessGuard(undefined);
});

// A Node child that reports its PID and a grandchild's, then waits. "graceful"
// exits 7 on Ctrl+Break; "stubborn" ignores it.
const CHILD = `
const { spawn } = require("node:child_process");
if (process.argv[1] === "stubborn") process.on("SIGBREAK", () => {});
else process.on("SIGBREAK", () => { console.log("break"); process.exit(7); });
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log("ready pid=" + process.pid + " grandchild=" + grandchild.pid + " secret=" + process.env.GUARD_TEST_SECRET);
setInterval(() => {}, 1000);
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

type Guarded = {
  child: ChildProcess;
  lines: string[];
  ready: Promise<{ pid: number; grandchild: number }>;
  exit: Promise<number | null>;
};

function startGuarded(mode: string): Guarded {
  const child = spawn(guard, ["--", process.execPath, "-e", CHILD, mode], {
    env: { ...process.env, GUARD_TEST_SECRET: "guard-secret-value" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  started.push(child);
  const lines: string[] = [];
  const ready = new Promise<{ pid: number; grandchild: number }>((resolve) => {
    let pending = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      pending += chunk;
      for (let newline; (newline = pending.indexOf("\n")) >= 0; ) {
        const line = pending.slice(0, newline).trimEnd();
        pending = pending.slice(newline + 1);
        lines.push(line);
        const match = /^ready pid=(\d+) grandchild=(\d+)/u.exec(line);
        if (match)
          resolve({ pid: Number(match[1]), grandchild: Number(match[2]) });
      }
    });
  });
  const exit = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  return { child, lines, ready, exit };
}

describe.skipIf(process.platform !== "win32" || !existsSync(guard))(
  "Windows process guard",
  () => {
    it("reports the service PID before any service output", async () => {
      const run = startGuarded("graceful");
      const { pid } = await run.ready;
      expect(guardHandshake(run.lines[0]!)).toBe(pid);
      expect(run.lines[1]).toMatch(/^ready /u);
      run.child.stdin!.end();
      await run.exit;
    });

    it("stops gracefully when its lifeline closes and forwards the exit code", async () => {
      const run = startGuarded("graceful");
      const { pid, grandchild } = await run.ready;
      run.child.stdin!.end();
      expect(await run.exit).toBe(7);
      expect(run.lines).toContain("break");
      expect(
        await waitUntil(() => !alive(pid) && !alive(grandchild), 5000),
      ).toBe(true);
    });

    it("terminates a service that ignores Ctrl+Break after the grace period", async () => {
      const run = startGuarded("stubborn");
      const { pid, grandchild } = await run.ready;
      const closed = Date.now();
      run.child.stdin!.end();
      await run.exit;
      expect(Date.now() - closed).toBeGreaterThanOrEqual(9_000);
      expect(alive(pid) || alive(grandchild)).toBe(false);
    }, 30_000);

    it("ends the service and its descendants when the guard is killed", async () => {
      const run = startGuarded("stubborn");
      const { pid, grandchild } = await run.ready;
      run.child.kill();
      await run.exit;
      expect(
        await waitUntil(() => !alive(pid) && !alive(grandchild), 5000),
      ).toBe(true);
    });

    it("keeps secrets in the environment, never on a command line", async () => {
      const run = startGuarded("graceful");
      const { pid } = await run.ready;
      expect(run.lines).toContainEqual(
        expect.stringContaining("secret=guard-secret-value"),
      );
      const commandLines = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid} OR ProcessId=${run.child.pid}").CommandLine`,
        ],
        { encoding: "utf8" },
      ).stdout;
      expect(commandLines).toContain("animama-process-guard");
      expect(commandLines).not.toContain("guard-secret-value");
      run.child.stdin!.end();
      await run.exit;
    }, 30_000);

    it("runs owned services and commands through the guard", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "animama-guard-"));
      roots.push(root);
      useProcessGuard(guard);
      const owned = new OwnedProcesses(path.join(root, "processes.json"));
      const service = owned.launch(
        "service",
        process.execPath,
        ["-e", CHILD, "graceful"],
        {},
        root,
      );
      expect(
        await waitUntil(() => /ready pid=/u.test(service.output), 10_000),
      ).toBe(true);
      expect(service.output).toContain(`ready pid=${service.processId} `);
      await owned.terminate(service);
      expect(owned.children.size).toBe(0);
      await expect(
        runCommand(
          process.execPath,
          ["-e", "process.stdout.write('only output')"],
          {},
          root,
        ),
      ).resolves.toBe("only output");
    }, 30_000);
  },
);
