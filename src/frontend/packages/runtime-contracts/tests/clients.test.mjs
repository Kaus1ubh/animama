import assert from "node:assert/strict";
import test from "node:test";
import { createClient, listAnimasV1AnimasGet } from "../dist/sdk.js";
import { client as defaultClient } from "../dist/default-client.js";

test("SDK methods preserve independent injected transports and legacy default identity", async () => {
  const calls = [];
  const makeTransport = (name) => async (request) => {
    calls.push([name, request.url]);
    return Response.json([]);
  };
  const a = createClient({ baseUrl: "https://owner-a.invalid", fetch: makeTransport("a") });
  const b = createClient({ baseUrl: "https://owner-b.invalid", fetch: makeTransport("b") });
  defaultClient.setConfig({ baseUrl: "https://local.invalid", fetch: makeTransport("local") });
  await Promise.all([
    listAnimasV1AnimasGet({ client: a }),
    listAnimasV1AnimasGet({ client: b }),
    listAnimasV1AnimasGet(),
  ]);
  assert.deepEqual(calls.map(([name, url]) => [name, new URL(url).origin]).sort(), [
    ["a", "https://owner-a.invalid"],
    ["b", "https://owner-b.invalid"],
    ["local", "https://local.invalid"],
  ]);
  assert.equal(a.getConfig().baseUrl, "https://owner-a.invalid");
  assert.equal(b.getConfig().baseUrl, "https://owner-b.invalid");
});
