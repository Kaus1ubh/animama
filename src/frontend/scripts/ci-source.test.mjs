import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  sourceCommands,
  validateSource,
  runCommand,
  saveReceipt,
} from "./ci-source.mjs";

test("full source plan prepares packages once before every consumer", () => {
  const commands = sourceCommands(["scripts/e2e/example.test.mjs"]);
  assert.deepEqual(commands[0], ["pnpm", "packages:build"]);
  assert.equal(
    commands.filter((command) => command.includes("packages:build")).length,
    1,
  );
  for (const script of [
    "e2e:check:source",
    "check:source",
    "test:source",
    "build:source",
    "packages:check",
    "packages:test",
    "desktop:check",
    "desktop:test",
    "web:lint",
    "openapi-ts:check",
    "i18n:check",
  ]) {
    assert.ok(
      commands.some((command) => command.includes(script)),
      script,
    );
  }
  assert.deepEqual(commands.at(-1), [
    "pnpm",
    "--filter",
    "animama-web",
    "build:source",
  ]);
});

test("standalone wrappers prepare packages while internal leaves do not rebuild", async () => {
  const web = JSON.parse(
    await readFile(new URL("../web/package.json", import.meta.url), "utf8"),
  );
  const frontend = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const script of ["check", "test", "build"]) {
    assert.equal(
      web.scripts[script],
      `pnpm --dir .. packages:build && pnpm ${script}:source`,
    );
    assert.ok(!web.scripts[`${script}:source`].includes("packages:build"));
  }
  assert.equal(
    frontend.scripts["e2e:check"],
    "pnpm --filter @animama/runtime-contracts build && pnpm e2e:check:source",
  );
  assert.equal(
    web.scripts["build:source"],
    "pnpm --dir .. poses:check && pnpm routes:generate && tsc -b && vite build",
  );
});

test("executes sequentially and records durations and success", async () => {
  const seen = [],
    receipts = [];
  let clock = 0;
  const commands = [["a"], ["b"]];
  assert.equal(
    await validateSource(commands, {
      run: async (command) => {
        seen.push(command);
        return { code: 0, signal: null };
      },
      save: async (receipt) => receipts.push(structuredClone(receipt)),
      now: () => (clock += 5),
    }),
    0,
  );
  assert.deepEqual(seen, commands);
  assert.equal(receipts.at(-1).status, "passed");
  assert.deepEqual(
    receipts.at(-1).commands.map((item) => item.duration_ms),
    [5, 5],
  );
});

test("failed preparation preserves exit and prevents all dependent commands", async () => {
  const seen = [],
    receipts = [];
  assert.equal(
    await validateSource([["prepare"], ["consumer"]], {
      run: async (command) => {
        seen.push(command);
        return { code: 37, signal: null };
      },
      save: async (receipt) => receipts.push(structuredClone(receipt)),
    }),
    37,
  );
  assert.deepEqual(seen, [["prepare"]]);
  assert.equal(receipts.at(-1).status, "failed");
});

test("leaf failure or launch exception never reports success", async () => {
  for (const throwing of [false, true]) {
    const receipts = [];
    let calls = 0;
    const code = await validateSource([["prepare"], ["test"], ["build"]], {
      run: async () => {
        if (++calls === 1) return { code: 0, signal: null };
        if (throwing) throw new Error("spawn failure");
        return { code: 143, signal: "SIGTERM" };
      },
      save: async (receipt) => receipts.push(structuredClone(receipt)),
    });
    assert.equal(code, throwing ? 1 : 143);
    assert.equal(calls, 2);
    assert.equal(receipts.at(-1).status, "failed");
  }
});

// Exercise real process results in addition to the injected command-plan tests.
test("subprocess exits and signals preserve failure codes", async () => {
  assert.deepEqual(
    await runCommand([process.execPath, "-e", "process.exit(19)"]),
    { code: 19, signal: null },
  );
  assert.deepEqual(
    await runCommand([
      process.execPath,
      "-e",
      "process.kill(process.pid, 'SIGTERM')",
    ]),
    { code: 143, signal: "SIGTERM" },
  );
});

test("receipts update regular files but never follow an existing target symlink", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "animama-source-receipt-"),
  );
  try {
    const target = path.join(directory, "receipt.json");
    await saveReceipt(target, { status: "running" });
    await saveReceipt(target, { status: "passed" });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
      status: "passed",
    });
    const protectedFile = path.join(directory, "protected.json");
    await writeFile(protectedFile, "unchanged");
    const link = path.join(directory, "link.json");
    await symlink(protectedFile, link);
    await assert.rejects(saveReceipt(link, { status: "passed" }));
    assert.equal(await readFile(protectedFile, "utf8"), "unchanged");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
