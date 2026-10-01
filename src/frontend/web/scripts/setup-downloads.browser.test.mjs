import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(webRoot, "tests/fixtures/setup-downloads");
let server, browser, origin;
before(async () => {
  server = await createServer({
    configFile: false,
    root: webRoot,
    publicDir: false,
    cacheDir: path.join(webRoot, "node_modules/.vite-setup-downloads"),
    logLevel: "error",
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"test"',
    },
    optimizeDeps: { entries: [path.join(fixture, "main.tsx")] },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function mount() {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const operations = [];
  const requests = [];
  const statuses = [
    "openai",
    "deepseek",
    "huggingface",
    "gemini",
    "elevenlabs",
  ].map((provider) => ({
    provider,
    configured: false,
    updatedAt: null,
    restartRequired: false,
  }));
  const asset = (id, size, extra = {}) => ({
    id,
    status: "not_installed",
    size_bytes: size,
    required_free_bytes: size,
    media_type: null,
    license_ref: "CC-BY-4.0",
    files_total: 1,
    files_verified: 0,
    ...extra,
  });
  // Backend model-asset state; installs apply in place without a reload.
  const assets = [
    asset("parakeet-stt", 661332409, { files_total: 7 }),
    asset("parakeet-stt-webgpu", 1238962007, {
      files_total: 3,
      requires: ["parakeet-stt"],
    }),
    asset("pocket-tts-voice-cloning-encoder", 39768446, {
      media_type: "application/octet-stream",
    }),
  ];
  const context = {
    principal_id: "00000000-0000-4000-8000-000000000188",
    bootstrap_status: "ready",
    failed_steps: [],
    first_run_complete: false,
    display_name: null,
  };
  await page.exposeFunction("fixtureNative", async (method, args) => {
    if (method === "credentials") return statuses;
    // Record only status and action names, never key values.
    operations.push({ method });
    if (method === "credentials.apply") {
      for (const change of args)
        Object.assign(
          statuses.find((status) => status.provider === change.provider),
          {
            configured: Boolean(change.value),
            updatedAt: change.value ? "2026-09-28T00:00:00Z" : null,
          },
        );
      return statuses;
    }
  });
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requests.push({ pathname, method: request.method() });
    if (pathname === "/v1/runtime-context")
      return route.fulfill({ json: context });
    if (pathname === "/v1/runtime/onboarding:complete") {
      const input = request.postDataJSON();
      assert.equal(input.adult_confirmed, true);
      assert.equal(input.display_name, "Ada Lovelace");
      context.first_run_complete = true;
      context.display_name = input.display_name;
      return route.fulfill({ json: context });
    }
    if (pathname === "/v1/model-assets")
      return route.fulfill({ json: { assets, free_bytes: 10000000000 } });
    const install = /^\/v1\/model-assets\/([a-z0-9-]+):install$/u.exec(
      pathname,
    );
    if (install && request.method() === "POST") {
      const target = assets.find((item) => item.id === install[1]);
      Object.assign(target, {
        status: "downloading",
        bytes_downloaded: 0,
        total_bytes: target.size_bytes,
        reason: null,
      });
      return route.fulfill({ status: 202, json: target });
    }
    if (pathname === "/v1/runtime-capabilities")
      return route.fulfill({
        json: { offline_speech_enabled: false },
      });
    return route.fulfill({
      status: 404,
      json: { detail: "Unexpected fixture route" },
    });
  });
  await page.goto(`${origin}/tests/fixtures/setup-downloads/index.html`);
  try {
    await page.getByLabel("Display name", { exact: true }).waitFor();
    await page.getByLabel("OpenAI", { exact: true }).waitFor();
  } catch (error) {
    console.error({
      errors,
      requests,
      body: await page.locator("body").innerText(),
    });
    throw error;
  }
  return { page, assets, statuses, operations, requests };
}
async function nameAndAge(page) {
  await page.getByLabel("Display name", { exact: true }).fill("Ada Lovelace");
  await page.getByLabel("I am 18 or older", { exact: true }).check();
}
const cpuDownload = (page) =>
  page.getByRole("button", { name: "Download CPU model", exact: true });
const continueButton = (page) =>
  page.getByRole("button", { name: "Continue", exact: true });
const installs = (requests) =>
  requests
    .filter((request) => request.pathname.endsWith(":install"))
    .map((request) => request.pathname);

test("skip all optional downloads and complete setup only with explicit valid name and age", async () => {
  const { page, operations, requests } = await mount();
  try {
    assert.equal(await continueButton(page).isEnabled(), false);
    await nameAndAge(page);
    await continueButton(page).click();
    await page.getByText("Setup complete", { exact: true }).waitFor();
    assert.deepEqual(operations, []);
    assert.equal(
      requests.filter((request) => request.method !== "GET").length,
      1,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("animama:setup-draft:"),
        ),
      ),
      [],
    );
  } finally {
    await page.close();
  }
});

test("a speech download starts beside an unsaved key, which stays editable and gates only Continue", async () => {
  const { page, operations, requests, assets } = await mount();
  try {
    await nameAndAge(page);
    const key = page.getByLabel("OpenAI", { exact: true });
    await key.fill("fixture-key-never-persisted");
    assert.equal(await continueButton(page).isEnabled(), false);
    // Installs apply in place, so unsaved keys never block them.
    await cpuDownload(page).click();
    await page
      .getByText(/Downloading \d+%/u)
      .first()
      .waitFor();
    assert.deepEqual(installs(requests), [
      "/v1/model-assets/parakeet-stt:install",
    ]);
    assert.equal(await key.isEnabled(), true);
    assert.equal(await key.inputValue(), "fixture-key-never-persisted");
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
          "fixture-key-never-persisted",
        ),
      ),
      false,
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved.", { exact: true }).waitFor();
    await continueButton(page).click();
    await page.getByText("Setup complete", { exact: true }).waitFor();
    assert.deepEqual(operations, [{ method: "credentials.apply" }]);
    // The transfer continues after setup.
    assert.equal(assets[0].status, "downloading");
  } finally {
    await page.close();
  }
});

test("name and age survive renderer recreation while a download continues", async () => {
  const { page } = await mount();
  try {
    await nameAndAge(page);
    await cpuDownload(page).click();
    await page
      .getByText(/Downloading \d+%/u)
      .first()
      .waitFor();
    await page.reload();
    assert.equal(
      await page.getByLabel("Display name", { exact: true }).inputValue(),
      "Ada Lovelace",
    );
    assert.equal(
      await page.getByLabel("I am 18 or older", { exact: true }).isChecked(),
      true,
    );
    await page
      .getByRole("button", { name: "Cancel download", exact: true })
      .first()
      .waitFor();
    await continueButton(page).click();
    await page.getByText("Setup complete", { exact: true }).waitFor();
  } finally {
    await page.close();
  }
});

test("a failed download offers retry without blocking setup", async () => {
  const { page, assets, requests } = await mount();
  try {
    await nameAndAge(page);
    await cpuDownload(page).click();
    await page
      .getByText(/Downloading \d+%/u)
      .first()
      .waitFor();
    Object.assign(assets[0], {
      status: "failed",
      reason: "asset_download_failed",
    });
    await page.reload();
    const retry = page.getByRole("button", {
      name: "Retry download",
      exact: true,
    });
    await retry.waitFor();
    assert.equal(await retry.isEnabled(), true);
    assert.equal(await continueButton(page).isEnabled(), true);
    await retry.click();
    await page
      .getByText(/Downloading \d+%/u)
      .first()
      .waitFor();
    assert.equal(installs(requests).length, 2);
  } finally {
    await page.close();
  }
});

test("downloads and key edits stay available when setup details cannot be retained", async () => {
  const { page, operations, requests } = await mount();
  try {
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error("storage unavailable");
      };
    });
    await nameAndAge(page);
    assert.equal(await page.getByText(/could not be retained/u).count(), 0);
    await page.getByLabel("OpenAI", { exact: true }).fill("fixture-key");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved.", { exact: true }).waitFor();
    await cpuDownload(page).click();
    await page
      .getByText(/Downloading \d+%/u)
      .first()
      .waitFor();
    assert.deepEqual(operations, [{ method: "credentials.apply" }]);
    assert.equal(installs(requests).length, 1);
  } finally {
    await page.close();
  }
});

test("credential removal and a failed-save retry also retain the unfinished setup fields", async () => {
  const fixture = await mount();
  try {
    const { page, statuses, operations } = fixture;
    await nameAndAge(page);
    statuses[0].configured = true;
    statuses[0].updatedAt = "2026-09-28T00:00:00Z";
    statuses[0].error = "secure_storage_unavailable";
    await page.reload();
    await page.getByText(/OpenAI: The key change could not finish/u).waitFor();
    assert.equal(
      await page.getByLabel("Display name", { exact: true }).inputValue(),
      "Ada Lovelace",
    );
    assert.equal(
      await page.getByLabel("I am 18 or older", { exact: true }).isChecked(),
      true,
    );
    await page
      .getByRole("button", { name: "Remove OpenAI key", exact: true })
      .click();
    delete statuses[0].error;
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved.", { exact: true }).waitFor();
    await page.reload();
    assert.equal(
      await page.getByLabel("Display name", { exact: true }).inputValue(),
      "Ada Lovelace",
    );
    assert.equal(
      await page.getByLabel("I am 18 or older", { exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await page.getByLabel("OpenAI", { exact: true }).inputValue(),
      "",
    );
    assert.equal(statuses[0].configured, false);
    assert.deepEqual(operations, [{ method: "credentials.apply" }]);
  } finally {
    await fixture.page.close();
  }
});
