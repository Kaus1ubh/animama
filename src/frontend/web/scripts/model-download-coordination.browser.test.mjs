import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = "tests/fixtures/model-download-coordination";
const assetId = "pocket-tts-voice-cloning-encoder";
let server, browser, origin;
before(async () => {
  server = await createServer({
    configFile: false,
    root: webRoot,
    cacheDir: path.join(
      webRoot,
      "node_modules/.vite/model-download-coordination-tests",
    ),
    publicDir: false,
    logLevel: "error",
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"test"',
    },
    optimizeDeps: { entries: [path.join(webRoot, fixture, "main.tsx")] },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});
async function mount(packState = "not_installed") {
  const page = await browser.newPage();
  await page.addInitScript((initial) => {
    const progress = new Set(),
      runtime = new Set();
    let state = initial,
      finish;
    const fixture = {
      installs: 0,
      pack(next) {
        state = next;
        for (const fn of progress)
          fn({ id: "document-processing", state, available: true });
      },
      ready() {
        for (const fn of runtime)
          fn({ state: "ready", origin: location.origin });
      },
      finish() {
        fixture.pack("installed");
        finish?.();
      },
    };
    window.nativeFixture = fixture;
    window.animamaDesktop = {
      isDesktop: true,
      version: 1,
      windowRole: "main",
      runtime: {
        status: async () => ({ state: "ready", origin: location.origin }),
        onStatus(fn) {
          runtime.add(fn);
          return () => runtime.delete(fn);
        },
      },
      featurePacks: {
        list: async () => [
          { id: "document-processing", state, available: true },
        ],
        onProgress(fn) {
          progress.add(fn);
          return () => progress.delete(fn);
        },
        install() {
          fixture.installs++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        cancel: async () => {
          fixture.pack("not_installed");
          finish?.();
        },
        remove: async () => {},
      },
    };
  }, packState);
  let status = "not_installed",
    held = false,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const requests = [];
  await page.route("**/v1/**", async (route) => {
    const method = route.request().method(),
      url = new URL(route.request().url());
    requests.push(method);
    if (method === "POST" && held) await gate;
    if (method === "POST") status = "downloading";
    if (method === "DELETE") status = "not_installed";
    const asset = {
      id: assetId,
      status,
      size_bytes: 10,
      required_free_bytes: 10,
      media_type: "application/octet-stream",
      license_ref: "CC-BY-4.0",
      files_total: 1,
      files_verified: 0,
    };
    await route.fulfill({
      json:
        url.pathname === "/v1/model-assets"
          ? { assets: [asset], free_bytes: 1000 }
          : asset,
    });
  });
  await page.goto(`${origin}/${fixture}/index.html`);
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="assets"]')
      ?.textContent.includes('"not_installed"'),
  );
  return {
    page,
    requests,
    hold() {
      held = true;
    },
    release,
    state(value) {
      status = value;
    },
    async close() {
      release();
      await page.close();
    },
  };
}
async function state(page, name) {
  return JSON.parse(await page.getByTestId(name).textContent());
}

test("newly mounted views share manager busy state and native progress after reload", async () => {
  const f = await mount("installing");
  try {
    await f.page.waitForFunction(
      () =>
        JSON.parse(document.querySelector('[data-testid="packs"]').textContent)
          .busy,
    );
    assert.equal((await state(f.page, "assets")).busy, true);
    await f.page
      .getByRole("button", { name: "Install voice", exact: true })
      .click();
    await f.page.waitForFunction(() =>
      JSON.parse(
        document.querySelector('[data-testid="assets"]').textContent,
      ).error?.includes("feature pack change"),
    );
    assert.equal(f.requests.includes("POST"), false);
    await f.page.getByRole("button", { name: "Toggle pack view" }).click();
    await f.page.getByRole("button", { name: "Toggle pack view" }).click();
    assert.equal((await state(f.page, "packs")).busy, true);
    await f.page.evaluate(() => window.nativeFixture.pack("installed"));
    await f.page.waitForFunction(
      () =>
        !JSON.parse(
          document.querySelector('[data-testid="assets"]').textContent,
        ).busy,
    );
  } finally {
    await f.close();
  }
});

test("backend request and download block packs, then interrupted state offers Retry after runtime recovery", async () => {
  const f = await mount();
  try {
    f.hold();
    await Promise.all([
      f.page.waitForRequest((request) => request.method() === "POST"),
      f.page
        .getByRole("button", { name: "Install voice", exact: true })
        .click(),
    ]);
    await f.page
      .getByRole("button", { name: "Install pack", exact: true })
      .click();
    await f.page.waitForFunction(() =>
      JSON.parse(
        document.querySelector('[data-testid="packs"]').textContent,
      ).error?.includes("model download"),
    );
    assert.equal(await f.page.evaluate(() => window.nativeFixture.installs), 0);
    f.release();
    await f.page.waitForFunction(() =>
      JSON.parse(
        document.querySelector('[data-testid="assets"]').textContent,
      ).states?.includes("downloading"),
    );
    assert.match((await state(f.page, "packs")).blocked, /model download/);
    f.state("not_installed");
    await f.page.evaluate(() => window.nativeFixture.ready());
    await f.page.waitForFunction(
      (id) =>
        JSON.parse(
          document.querySelector('[data-testid="assets"]').textContent,
        ).retries.includes(id),
      assetId,
    );
    await f.page.reload();
    await f.page.waitForFunction(
      (id) =>
        JSON.parse(
          document.querySelector('[data-testid="assets"]')?.textContent || "{}",
        ).retries?.includes(id),
      assetId,
    );
  } finally {
    await f.close();
  }
});

test("native request gaps block installs but allow explicit backend cancellation", async () => {
  const f = await mount();
  try {
    await f.page
      .getByRole("button", { name: "Install pack", exact: true })
      .click();
    await f.page.waitForFunction(() => window.nativeFixture.installs === 1);
    await f.page
      .getByRole("button", { name: "Install voice", exact: true })
      .click();
    await f.page.waitForFunction(() =>
      JSON.parse(
        document.querySelector('[data-testid="assets"]').textContent,
      ).error?.includes("feature pack change"),
    );
    assert.equal(f.requests.includes("POST"), false);
    await f.page
      .getByRole("button", { name: "Cancel voice", exact: true })
      .click();
    await f.page.waitForFunction(
      () =>
        !JSON.parse(
          document.querySelector('[data-testid="assets"]').textContent,
        ).pending,
    );
    assert.equal(f.requests.includes("DELETE"), true);
    await f.page.evaluate(() => window.nativeFixture.finish());
    await f.page.waitForFunction(
      () =>
        !JSON.parse(document.querySelector('[data-testid="packs"]').textContent)
          .busy,
    );
  } finally {
    await f.close();
  }
});

test("another self-host window refreshes both sides of a held install request", async () => {
  const context = await browser.newContext();
  const source = await context.newPage();
  const other = await context.newPage();
  let status = "not_installed",
    release,
    started;
  const postStarted = new Promise((resolve) => {
    started = resolve;
  });
  const heldPost = new Promise((resolve) => {
    release = resolve;
  });
  const gets = new Map([
    [source, 0],
    [other, 0],
  ]);
  await context.route("**/v1/**", async (route) => {
    const request = route.request();
    const page = request.frame().page();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET") gets.set(page, gets.get(page) + 1);
    if (request.method() === "POST") {
      started();
      await heldPost;
      status = "downloading";
    }
    if (request.method() === "DELETE") status = "not_installed";
    const asset = {
      id: assetId,
      status,
      size_bytes: 10,
      required_free_bytes: 10,
      media_type: "application/octet-stream",
      license_ref: "CC-BY-4.0",
      files_total: 1,
      files_verified: 0,
    };
    await route.fulfill({
      json:
        pathname === "/v1/model-assets"
          ? { assets: [asset], free_bytes: 1000 }
          : asset,
    });
  });
  try {
    for (const page of [source, other]) {
      await page.goto(`${origin}/${fixture}/index.html`);
      await page.waitForFunction(() =>
        JSON.parse(
          document.querySelector('[data-testid="assets"]')?.textContent || "{}",
        ).states?.includes("not_installed"),
      );
    }
    const before = gets.get(other);
    const beginRefresh = other.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/v1/model-assets",
      { timeout: 2000 },
    );
    await source
      .getByRole("button", { name: "Install voice", exact: true })
      .click();
    await postStarted;
    await beginRefresh;
    assert.ok(gets.get(other) > before);
    assert.deepEqual((await state(other, "assets")).states, ["not_installed"]);
    // The first refresh legitimately sees idle: only the settled pulse can
    // discover downloading, because missing assets do not poll forever.
    release();
    await other.waitForFunction(
      () =>
        JSON.parse(
          document.querySelector('[data-testid="assets"]').textContent,
        ).states.includes("downloading"),
      undefined,
      { timeout: 2500 },
    );
    assert.deepEqual((await state(other, "assets")).retries, []);
    await other
      .getByRole("button", { name: "Cancel voice", exact: true })
      .click();
    await source.waitForFunction(() =>
      JSON.parse(
        document.querySelector('[data-testid="assets"]').textContent,
      ).states.includes("not_installed"),
    );
    assert.deepEqual((await state(source, "assets")).retries, []);
    assert.deepEqual((await state(other, "assets")).retries, []);
  } finally {
    release();
    await context.close();
  }
});

test("installing or removing a speech set refreshes runtime capabilities", async () => {
  const page = await browser.newPage();
  let status = "not_installed";
  let capabilityRequests = 0;
  await page.route("**/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/v1/runtime-capabilities") {
      capabilityRequests += 1;
      return route.fulfill({ status: 503, json: { detail: "fixture" } });
    }
    await route.fulfill({
      json: {
        assets: [
          {
            id: "parakeet-stt",
            status,
            size_bytes: 10,
            required_free_bytes: 10,
            media_type: null,
            license_ref: "CC-BY-4.0",
            files_total: 7,
            files_verified: status === "installed" ? 7 : 0,
          },
        ],
        free_bytes: 1000,
      },
    });
  });
  try {
    await page.goto(`${origin}/${fixture}/index.html?capabilities`);
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="assets"]')
        ?.textContent.includes('"not_installed"'),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="capabilities"]')?.textContent ===
        "error",
    );
    const initial = capabilityRequests;
    for (const next of ["installed", "not_installed"]) {
      const before = capabilityRequests;
      status = next;
      await page.evaluate(() => window.refreshDownloads());
      await page.waitForFunction(
        (expected) =>
          JSON.parse(
            document.querySelector('[data-testid="assets"]').textContent,
          ).states.includes(expected),
        next,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(capabilityRequests > before, `refetch after ${next}`);
    }
    assert.ok(capabilityRequests >= initial + 2);
  } finally {
    await page.close();
  }
});
