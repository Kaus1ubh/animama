import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let temporary;
let browser;
let bundle;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "animama-chat-consumer-"));
  const modules = join(temporary, "node_modules");
  // Copy only publishable package inputs. Third-party dependencies reuse the
  // installed graph, but neither package may resolve back to workspace source.
  for (const name of ["product-ui", "runtime-contracts"]) {
    const source = resolve(packageRoot, "..", name);
    const target = join(modules, "@animama", name);
    await mkdir(target, { recursive: true });
    await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
    await cp(join(source, "package.json"), join(target, "package.json"));
    const manifest = JSON.parse(
      await readFile(join(source, "package.json"), "utf8"),
    );
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      if (dependency.startsWith("@animama/")) continue;
      const link = join(modules, dependency);
      await mkdir(dirname(link), { recursive: true });
      await symlink(join(source, "node_modules", dependency), link).catch(
        (error) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    }
  }
  await cp(
    join(packageRoot, "tests/chat-consumer.jsx"),
    join(temporary, "consumer.jsx"),
  );
  const result = await build({
    absWorkingDir: temporary,
    entryPoints: ["consumer.jsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: "consumer.js",
    write: false,
    metafile: true,
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const inputs = Object.keys(result.metafile.inputs).map((path) =>
    resolve(temporary, path),
  );
  assert(
    inputs.some((path) =>
      path.startsWith(join(modules, "@animama/product-ui/dist")),
    ),
  );
  assert(
    inputs.some((path) =>
      path.startsWith(join(modules, "@animama/runtime-contracts/dist")),
    ),
  );
  assert(
    !inputs.some((path) =>
      path.startsWith(resolve(packageRoot, "../..", "web")),
    ),
  );
  assert(
    !inputs.some((path) =>
      /packages\/(product-ui|runtime-contracts)\/(src|dist)\//.test(path),
    ),
  );
  bundle = result.outputFiles.find(
    (file) => file.path.endsWith(".js") || file.path === "<stdout>",
  ).text;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

/** Each test owns a fresh DOM, hook instance, transport and event transcript. */
async function consumer(t) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("#start");
  return page;
}
async function start(page, count = 1) {
  await page.click("#start");
  await page.waitForFunction(
    (count) => window.fixture.requests().length === count,
    count,
  );
}
async function idle(page) {
  await page.waitForFunction(
    () => window.fixture.settled().length === window.fixture.requests().length,
  );
  await page.waitForFunction(
    () => document.querySelector("#streaming")?.textContent === "false",
  );
  assert.equal(await page.isDisabled("#stop"), true);
}

test("built consumer uses its injected owner and transport and receives incremental text", async (t) => {
  const page = await consumer(t);
  assert.equal(await page.textContent("#owner"), "owner-fixture");
  await start(page);
  const [request] = await page.evaluate(() => window.fixture.requests());
  assert.equal(
    request.url,
    "https://chat-fixture.invalid/v1/animas/anima-fixture/chat:sse",
  );
  assert.equal(request.method, "POST");
  assert.equal(request.body.run_id, "run-1");
  assert.equal(request.authorization, null);
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [{ text: "first", run_id: "run-1" }]);
  });
  await page.waitForFunction(
    () => document.querySelector("#transcript").textContent === "first",
  );
  assert.equal(await page.textContent("#streaming"), "true");
  await page.evaluate(() => {
    window.fixture.send(0, [{ run_id: "run-1", chat_id: "chat-fixture" }]);
    window.fixture.close(0);
  });
  await idle(page);
  assert.deepEqual(await page.evaluate(() => window.fixture.events()), [
    ["open", "run-1"],
    ["token", "first"],
    ["complete", "run-1"],
  ]);
});

test("a completed run releases transport without waiting for EOF", async (t) => {
  const page = await consumer(t);
  await start(page);
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [{ run_id: "run-1" }]);
  });
  await idle(page);
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.fixture.events()), [
    ["open", "run-1"],
    ["complete", "run-1"],
  ]);
});

test("Stop aborts transport and discards buffered late transcript and store callbacks", async (t) => {
  const page = await consumer(t);
  await start(page);
  // Stop in the same task that releases response bytes, before promise continuations.
  const abortedOnStop = await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [
      { text: "late", run_id: "run-1" },
      { emotions: [], run_id: "run-1" },
      { type: "chat.title.updated", title: "late", run_id: "run-1" },
      {
        gesture: "wave",
        runtime_revision: "revision-fixture",
        run_id: "run-1",
      },
      { run_id: "run-1" },
    ]);
    window.fixture.stop();
    window.fixture.close(0);
    return window.fixture.requests()[0].aborted;
  });
  assert.equal(abortedOnStop, true);
  await idle(page);
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
  assert.equal(await page.textContent("#transcript"), "");
  assert.deepEqual(
    await page.evaluate(() =>
      window.fixture.events().filter(([kind]) => kind !== "open"),
    ),
    [],
  );
  assert.equal(
    (await page.evaluate(() => window.fixture.requests())).length,
    1,
  );
});

test("Stop cancels an open stream and permits a fresh Start", async (t) => {
  const page = await consumer(t);
  await start(page);
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [{ text: "first" }]);
  });
  await page.waitForFunction(
    () => document.querySelector("#transcript").textContent === "first",
  );
  await page.click("#stop");
  await idle(page);
  await page.waitForFunction(() => window.fixture.requests()[0].cancelled);
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
  await start(page, 2);
  await page.evaluate(() => {
    window.fixture.respond(1);
    window.fixture.close(1);
  });
  await idle(page);
});

test("unmount aborts pending work and prevents late callbacks", async (t) => {
  const page = await consumer(t);
  await start(page);
  const before = await page.evaluate(() => {
    window.fixture.unmount();
    return window.fixture.events();
  });
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [{ text: "late" }, { run_id: "run-1" }]);
    window.fixture.close(0);
  });
  await page.waitForFunction(() => window.fixture.settled().includes("run-1"));
  assert.deepEqual(await page.evaluate(() => window.fixture.events()), before);
});

test("replaced stream cannot clear active controls or deliver stale events", async (t) => {
  const page = await consumer(t);
  await start(page);
  await start(page, 2);
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [{ text: "old" }, { run_id: "run-1" }]);
    window.fixture.close(0);
  });
  await page.waitForFunction(() => window.fixture.settled().includes("run-1"));
  assert.equal(await page.textContent("#streaming"), "true");
  assert.equal(await page.textContent("#transcript"), "");
  await page.evaluate(() => {
    window.fixture.respond(1);
    window.fixture.send(1, [
      { text: "wrong", run_id: "run-1" },
      { error: "stale error", run_id: "run-1" },
      { text: "new", run_id: "run-2" },
      { run_id: "run-2" },
    ]);
    window.fixture.close(1);
  });
  await idle(page);
  assert.equal(await page.textContent("#transcript"), "new");
  assert.equal(
    (await page.evaluate(() => window.fixture.events())).filter(
      ([kind]) => kind === "error",
    ).length,
    0,
  );
});

test("Stop during a token callback discards already parsed frames", async (t) => {
  const page = await consumer(t);
  await start(page);
  await page.evaluate(() => {
    window.fixture.stopOnToken();
    window.fixture.respond(0);
    window.fixture.send(0, [
      { text: "first" },
      { text: "late" },
      { emotions: [] },
      { run_id: "run-1" },
    ]);
    window.fixture.close(0);
  });
  await page.waitForFunction(() => window.fixture.settled().includes("run-1"));
  await idle(page);
  assert.equal(await page.textContent("#transcript"), "first");
  assert.deepEqual(await page.evaluate(() => window.fixture.events()), [
    ["open", "run-1"],
    ["token", "first"],
  ]);
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
});

test("changing injected owner releases the previous mounted stream", async (t) => {
  const page = await consumer(t);
  await start(page);
  await page.evaluate(() => window.fixture.mount("second-owner"));
  await page.waitForFunction(
    () => document.querySelector("#owner").textContent === "second-owner",
  );
  assert.equal(
    (await page.evaluate(() => window.fixture.requests()))[0].aborted,
    true,
  );
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.close(0);
  });
  await page.waitForFunction(() => window.fixture.settled().includes("run-1"));
  await idle(page);
  assert.equal(await page.textContent("#transcript"), "");
  await start(page, 2);
  await page.evaluate(() => {
    window.fixture.respond(1);
    window.fixture.close(1);
  });
  await idle(page);
});

for (const mode of ["incomplete", "http-error", "stream-error"]) {
  test(`${mode} restores controls without retrying the POST`, async (t) => {
    const page = await consumer(t);
    await start(page);
    await page.evaluate((mode) => {
      window.fixture.respond(0, mode === "http-error" ? 503 : 200);
      if (mode === "stream-error") window.fixture.fail(0);
      else window.fixture.close(0);
    }, mode);
    await idle(page);
    const events = await page.evaluate(() => window.fixture.events());
    assert.equal(events.filter(([kind]) => kind === "complete").length, 0);
    assert.equal(events.filter(([kind]) => kind === "error").length, 1);
    assert.equal(
      (await page.evaluate(() => window.fixture.requests())).length,
      1,
    );
  });
}

test("an error is terminal: duplicate errors, late text and run.completed cannot finalize it", async (t) => {
  const page = await consumer(t);
  await start(page);
  await page.evaluate(() => {
    window.fixture.respond(0);
    window.fixture.send(0, [
      { error: "missing key", code: "missing_api_key", run_id: "run-1" },
      { error: "duplicate", run_id: "run-1" },
      { text: "not a success", run_id: "run-1" },
      { run_id: "run-1" },
    ]);
  });
  await idle(page);
  const events = await page.evaluate(() => window.fixture.events());
  assert.equal(events.filter(([kind]) => kind === "error").length, 1);
  assert.equal(
    events.filter(([kind]) => kind === "complete" || kind === "token").length,
    0,
  );
});

test("known error guidance is specific and unknown payloads never become display text", async (t) => {
  const page = await consumer(t);
  const values = await page.evaluate(() => {
    const codes = [
      "missing_api_key",
      "openai_authentication_error",
      "openai_permission_denied",
      "openai_quota_exceeded",
      "openai_rate_limit",
      "openai_overloaded",
      "openai_timeout",
      "chat_stream_interrupted",
    ];
    return {
      known: codes.map((code) =>
        window.fixture.describeFailure(
          { code, details: { retry_after_seconds: 3.2 } },
          "hello",
        ),
      ),
      unknown: window.fixture.describeFailure(
        {
          code: "secret_key",
          error: "secret payload",
          details: { body: "secret prompt" },
        },
        "hello",
      ),
      gateway: window.fixture.describeFailure(
        { status: 403, body: { error: "gateway_request_rejected" } },
        "hello",
      ),
      denied: window.fixture.describeFailure({ status: 403 }, "hello"),
      network: window.fixture.describeFailure(
        new TypeError("secret URL"),
        "hello",
      ),
    };
  });
  assert.equal(
    new Set(values.known.map((value) => value.title)).size,
    values.known.length,
  );
  assert.equal(values.known[4].retryAfterSeconds, 4);
  assert.equal(values.unknown.code, "chat_request_failed");
  assert(!JSON.stringify(values).includes("secret"));
  assert.equal(values.gateway.code, "gateway_request_rejected");
  assert.equal(values.denied.code, "chat_request_failed");
  assert.match(values.network.title, /connect/);
});

async function sessionConsumer(t) {
  const page = await consumer(t);
  await page.evaluate(() => window.fixture.mountSession());
  await page.waitForFunction(
    () => document.querySelector("#submit")?.disabled === false,
  );
  return page;
}
async function submitSession(page, text, count = 1) {
  await page.fill("#draft", text);
  await page.click("#submit");
  await page.waitForFunction(
    (count) => window.fixture.requests().length === count,
    count,
  );
}
async function sessionIdle(page) {
  await page.waitForFunction(
    () => document.querySelector("#streaming").textContent === "false",
  );
}

test("failed session retains partial text and restores a message without sending or overwriting a draft", async (t) => {
  const page = await sessionConsumer(t);
  await submitSession(page, "original message");
  await page.evaluate(() => {
    window.fixture.respond(0);
    const run_id = window.fixture.requests()[0].body.run_id;
    window.fixture.send(0, [{ text: "Partial answer", run_id }]);
  });
  await page.getByText("Partial answer", { exact: true }).waitFor();
  await page.evaluate(() => window.fixture.close(0));
  await page.getByRole("alert").waitFor();
  await sessionIdle(page);
  assert.match(await page.getByRole("alert").textContent(), /interrupted/);
  await page.getByText("Incomplete reply", { exact: true }).waitFor();
  await page.getByText("Partial answer", { exact: true }).waitFor();
  await page.fill("#draft", "new draft");
  assert.equal(
    await page.getByRole("button", { name: "Restore message" }).isDisabled(),
    true,
  );
  assert.equal(await page.inputValue("#draft"), "new draft");
  await page.fill("#draft", "");
  await page.getByRole("button", { name: "Restore message" }).click();
  assert.equal(await page.inputValue("#draft"), "original message");
  assert.equal(
    (await page.evaluate(() => window.fixture.requests())).length,
    1,
  );
  await page.evaluate(() => window.fixture.switchChat());
  await page.waitForFunction(
    () => document.querySelectorAll('[role="alert"]').length === 0,
  );
});

test("provider failure stays visible after terminal frame and a later successful turn", async (t) => {
  const page = await sessionConsumer(t);
  await submitSession(page, "failed message");
  await page.evaluate(() => {
    window.fixture.respond(0);
    const run_id = window.fixture.requests()[0].body.run_id;
    window.fixture.send(0, [
      { error: "do not expose raw payload", code: "missing_api_key", run_id },
      { run_id },
    ]);
  });
  await page.getByRole("alert").waitFor();
  await sessionIdle(page);
  assert.match(await page.getByRole("alert").textContent(), /isn't configured/);
  assert(!(await page.textContent("body")).includes("raw payload"));
  await submitSession(page, "next message", 2);
  await page.evaluate(() => {
    window.fixture.respond(1);
    const run_id = window.fixture.requests()[1].body.run_id;
    window.fixture.send(1, [
      { text: "Successful answer", run_id },
      { run_id, chat_id: "chat-fixture" },
    ]);
  });
  await sessionIdle(page);
  await page.getByText("Successful answer", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 1);
  const text = await page.textContent('[aria-label="Conversation"]');
  assert(text.indexOf("isn't configured") < text.indexOf("next message"));
  assert.equal(
    (await page.evaluate(() => window.fixture.requests())).length,
    2,
  );
});

test("intentional Stop never creates an error notice", async (t) => {
  const page = await sessionConsumer(t);
  await submitSession(page, "stop this");
  await page.evaluate(() => window.fixture.respond(0));
  await page.click("#stop");
  await sessionIdle(page);
  assert.equal(await page.getByRole("alert").count(), 0);
});

test("text and error in one chunk preserve the partial answer without success", async (t) => {
  const page = await sessionConsumer(t);
  await submitSession(page, "same chunk");
  await page.evaluate(() => {
    window.fixture.respond(0);
    const run_id = window.fixture.requests()[0].body.run_id;
    window.fixture.send(0, [
      { text: "Keep this partial text", run_id },
      { error: "failure", code: "openai_overloaded", run_id },
      { run_id },
    ]);
  });
  await page.getByRole("alert").waitFor();
  await sessionIdle(page);
  await page.getByText("Keep this partial text", { exact: true }).waitFor();
  assert.match(
    await page.getByRole("alert").textContent(),
    /temporarily unavailable/,
  );
  assert.equal(
    (await page.evaluate(() => window.fixture.requests())).length,
    1,
  );
});
