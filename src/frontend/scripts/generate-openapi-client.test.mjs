import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalizeGeneratedSource,
  checkGeneratedClient,
  generateOpenApiClient,
} from "./generate-openapi-client.mjs";

test("generator removes its private schema when client generation fails", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "animama-openapi-test-"),
  );
  let schemaPath;
  let callCount = 0;

  await assert.rejects(
    generateOpenApiClient({
      createTemporaryDirectory: async () => temporaryDirectory,
      commandRunner: async (_command, args) => {
        callCount += 1;
        if (callCount === 1) {
          schemaPath = args.at(-1);
          await writeFile(schemaPath, '{"openapi":"3.1.0"}\n');
          return;
        }
        throw new Error("synthetic generator failure");
      },
    }),
    /synthetic generator failure/,
  );

  assert.equal(callCount, 2);
  await assert.rejects(access(temporaryDirectory));
  await assert.rejects(access(schemaPath));
});

/** Keep all candidate/committed fixture bytes outside the repository. */
async function clientFixture(
  t,
  { committed = {}, candidate = {}, tracked = Object.keys(committed) } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "animama-sdk-freshness-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const committedRoot = join(root, "committed");
  const candidateRoot = join(root, "candidate");
  for (const [directory, entries] of [
    [committedRoot, committed],
    [candidateRoot, candidate],
  ]) {
    await mkdir(directory, { recursive: true });
    for (const [name, body] of Object.entries(entries)) {
      await mkdir(join(directory, name, ".."), { recursive: true });
      await writeFile(join(directory, name), body);
    }
  }
  return {
    root,
    committedRoot,
    candidateRoot,
    trackedFiles: async () => tracked,
  };
}

test("freshness compares canonical bytes without rewriting either source", async (t) => {
  const committed = "export type Mode = 'local';\n";
  const candidate = 'export type Mode="local";\n';
  const fixture = await clientFixture(t, {
    committed: { "types.gen.ts": committed },
    candidate: { "types.gen.ts": candidate },
  });
  assert.equal(await checkGeneratedClient(fixture), 1);
  assert.equal(
    await readFile(join(fixture.committedRoot, "types.gen.ts"), "utf8"),
    committed,
  );
  assert.equal(
    await readFile(join(fixture.candidateRoot, "types.gen.ts"), "utf8"),
    candidate,
  );
  assert.equal(
    await canonicalizeGeneratedSource(committed, "types.gen.ts"),
    await canonicalizeGeneratedSource(candidate, "types.gen.ts"),
  );
});

test("freshness rejects stale, missing, deleted and extra tracked output with path-only diagnostics", async (t) => {
  const fixture = await clientFixture(t, {
    committed: {
      "stale.ts": 'export const secret = "old-private-value";',
      "extra.ts": "export {};",
    },
    candidate: {
      "stale.ts": 'export const secret = "new-private-value";',
      "missing.ts": "export {};",
      "deleted.ts": "export {};",
    },
    tracked: ["stale.ts", "extra.ts", "deleted.ts"],
  });
  await assert.rejects(checkGeneratedClient(fixture), (error) => {
    assert.match(error.message, /stale: stale.ts/);
    assert.match(error.message, /missing: missing.ts/);
    assert.match(error.message, /missing: deleted.ts/);
    assert.match(error.message, /extra: extra.ts/);
    assert.doesNotMatch(error.message, /private-value/);
    return true;
  });
});

test("freshness rejects empty generation and bounds large inventories", async (t) => {
  const fixture = await clientFixture(t);
  await assert.rejects(checkGeneratedClient(fixture), /produced no files/);
  await writeFile(join(fixture.candidateRoot, "current.ts"), "export {};");
  await assert.rejects(
    checkGeneratedClient({
      ...fixture,
      trackedFiles: async () =>
        Array.from({ length: 30 }, (_, i) => `extra-${i}.ts`),
    }),
    (error) => {
      assert.match(error.message, /31 files/);
      assert.match(error.message, /11 more paths/);
      assert.equal(
        error.message
          .split("\n")
          .filter((line) => /^  (?:missing|extra):/.test(line)).length,
        20,
      );
      return true;
    },
  );
});

for (const failureStage of ["export", "generate", "compare", null]) {
  test(`check output stays temporary and cleanup survives ${failureStage ?? "success"}`, async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "animama-sdk-check-"),
    );
    let callCount = 0;
    let compared = false;
    const operation = generateOpenApiClient({
      check: true,
      createTemporaryDirectory: async () => temporaryDirectory,
      commandRunner: async (command, args, options) => {
        callCount += 1;
        if (callCount === 1) {
          assert.equal(command, "uv");
          assert.deepEqual(args.slice(0, 3), ["run", "--frozen", "--no-sync"]);
          assert.equal(options.env.ANIMAMA_LOG_TO_FILE, "0");
          if (failureStage === "export")
            throw new Error("synthetic export failure");
          await writeFile(args.at(-1), '{"openapi":"3.1.0"}');
        } else {
          assert.equal(command, "pnpm");
          assert.equal(
            options.env.ANIMAMA_LOCAL_OPENAPI_PATH,
            join(temporaryDirectory, "local-openapi.json"),
          );
          assert.equal(
            options.env.ANIMAMA_LOCAL_OPENAPI_OUTPUT,
            join(temporaryDirectory, "generated"),
          );
          if (failureStage === "generate")
            throw new Error("synthetic generate failure");
          await mkdir(options.env.ANIMAMA_LOCAL_OPENAPI_OUTPUT);
          await writeFile(
            join(options.env.ANIMAMA_LOCAL_OPENAPI_OUTPUT, "sdk.gen.ts"),
            "export {};",
          );
        }
      },
      checkClient: async ({ candidateRoot }) => {
        compared = true;
        assert.equal(candidateRoot, join(temporaryDirectory, "generated"));
        if (failureStage === "compare")
          throw new Error("synthetic compare failure");
        return 1;
      },
    });
    if (failureStage)
      await assert.rejects(
        operation,
        new RegExp(`synthetic ${failureStage} failure`),
      );
    else await operation;
    assert.equal(callCount, failureStage === "export" ? 1 : 2);
    assert.equal(compared, failureStage === "compare" || failureStage === null);
    await assert.rejects(access(temporaryDirectory));
  });
}

test("write mode retains the repository destination and does not compare", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "animama-sdk-write-"),
  );
  const commands = [];
  await generateOpenApiClient({
    createTemporaryDirectory: async () => temporaryDirectory,
    commandRunner: async (command, args, options) =>
      commands.push({ command, args, options }),
    checkClient: async () =>
      assert.fail("write mode must not run the freshness comparison"),
  });
  assert.equal(commands.length, 2);
  assert.match(
    commands[1].options.env.ANIMAMA_LOCAL_OPENAPI_OUTPUT,
    /packages\/runtime-contracts\/src\/generated$/,
  );
  assert.notEqual(
    commands[1].options.env.ANIMAMA_LOCAL_OPENAPI_OUTPUT,
    join(temporaryDirectory, "generated"),
  );
  await assert.rejects(access(temporaryDirectory));
});

test("formatting errors fail without exposing source excerpts", async (t) => {
  const fixture = await clientFixture(t, {
    committed: { "invalid.ts": "export type Example = string;" },
    candidate: {
      "invalid.ts": 'export type Example = "private-invalid-payload" + ;',
    },
  });
  await assert.rejects(checkGeneratedClient(fixture), (error) => {
    assert.match(error.message, /Cannot format generated SDK file: invalid.ts/);
    assert.doesNotMatch(error.message, /private-invalid-payload/);
    return true;
  });
});
