import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateOpenApiClient } from "./generate-openapi-client.mjs";

test("generator removes its private schema when client generation fails", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "animama-openapi-test-"));
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
