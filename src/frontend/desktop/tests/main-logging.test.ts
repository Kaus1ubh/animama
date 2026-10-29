import type { App } from "electron";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;

// Each test loads a fresh module so its log path and limits start unset.
async function startLogging(limits: { maxBytes: number; backups: number }) {
  vi.resetModules();
  const logging = await import("../src/main-process/logging.js");
  const app = { getPath: () => root, setAppLogsPath: vi.fn() };
  logging.initializeLogging(app as unknown as App, limits);
  return logging;
}

describe("main.log", () => {
  beforeEach(() => {
    // privateDirectory rejects symlinked ancestors such as macOS's /var.
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "animama-log-")));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rotates at its size limit and keeps a fixed number of older files", async () => {
    const { writeLog } = await startLogging({ maxBytes: 400, backups: 2 });

    for (let index = 0; index < 30; index += 1) {
      writeLog("info", `line ${index} ${"x".repeat(60)}`);
    }

    const logs = path.join(root, "runtime", "logs");
    const files = ["main.log", "main.log.1", "main.log.2"];
    expect(readdirSync(logs).sort()).toEqual(files);
    for (const file of files) {
      expect(statSync(path.join(logs, file)).size).toBeLessThanOrEqual(400);
    }
    const lineNumbers = (file: string) =>
      [...readFileSync(path.join(logs, file), "utf8").matchAll(/line (\d+)/g)]
        .map((match) => Number(match[1]))
        .filter((value) => !Number.isNaN(value));
    const newest = lineNumbers("main.log");
    const previous = lineNumbers("main.log.1");
    expect(newest.at(-1)).toBe(29);
    expect(previous.at(-1)).toBe(newest[0]! - 1);
    expect(Math.max(...lineNumbers("main.log.2"))).toBeLessThan(previous[0]!);
  });

  it("keeps every backup when main.log cannot be moved", async () => {
    const logs = path.join(root, "runtime", "logs");
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(logs, "main.log"), "current\n".repeat(20));
    writeFileSync(path.join(logs, "main.log.1"), "backup 1\n");
    writeFileSync(path.join(logs, "main.log.2"), "backup 2\n");
    // A non-empty directory in the way makes moving main.log aside fail.
    mkdirSync(path.join(logs, "main.log.rotating"));
    writeFileSync(path.join(logs, "main.log.rotating", "held"), "");
    const { writeLog } = await startLogging({ maxBytes: 100, backups: 2 });

    for (let index = 0; index < 3; index += 1) {
      writeLog("info", `after failed rotation ${index}`);
    }

    expect(readFileSync(path.join(logs, "main.log.1"), "utf8")).toBe(
      "backup 1\n",
    );
    expect(readFileSync(path.join(logs, "main.log.2"), "utf8")).toBe(
      "backup 2\n",
    );
    expect(readFileSync(path.join(logs, "main.log"), "utf8")).toContain(
      "after failed rotation 2",
    );
  });

  it("writes a line larger than the limit instead of dropping it", async () => {
    const { writeLog } = await startLogging({ maxBytes: 100, backups: 1 });

    writeLog("error", "y".repeat(300));

    const log = readFileSync(
      path.join(root, "runtime", "logs", "main.log"),
      "utf8",
    );
    expect(log).toContain("y".repeat(300));
  });
});
