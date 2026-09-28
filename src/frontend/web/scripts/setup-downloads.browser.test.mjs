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
  const packs = [
    {
      id: "parakeet-stt",
      state: "not_installed",
      available: true,
      version: "1",
      downloadBytes: 661332409,
      installedBytes: 661332409,
      minimumFreeBytes: 1400000000,
    },
  ];
  let finishPack;
  const pendingPack = new Promise((resolve) => {
    finishPack = resolve;
  });
  const context = {
    principal_id: "00000000-0000-4000-8000-000000000188",
    bootstrap_status: "ready",
    failed_steps: [],
    first_run_complete: false,
    display_name: null,
  };
  await page.exposeFunction("fixtureNative", async (method, args) => {
    if (method === "packs") return packs;
    if (method === "credentials") return statuses;
    // Record only status and action names, never key values.
    operations.push({
      method,
      ...(typeof args === "string" ? { id: args } : {}),
    });
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
    if (method === "install") {
      packs[0].state = "downloading";
      await pendingPack;
      packs[0].state = "installed";
      packs[0].activeVersion = "1";
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
      return route.fulfill({ json: { assets: [], free_bytes: 10000000000 } });
    if (pathname === "/v1/runtime-capabilities")
      return route.fulfill({
        json: { offline_speech_enabled: false, parakeet_webgpu_enabled: false },
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
  return { page, packs, statuses, operations, requests, finishPack };
}
async function nameAndAge(page) {
  await page.getByLabel("Display name", { exact: true }).fill("Ada Lovelace");
  await page.getByLabel("I am 18 or older", { exact: true }).check();
}
const cpuDownload = (page) =>
  page.getByRole("button", { name: /Download speech recognition/u });

test("skip all optional downloads and complete setup only with explicit valid name and age", async () => {
  const fixture = await mount();
  try {
    const { page, operations, requests } = fixture;
    assert.equal(
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .isEnabled(),
      false,
    );
    await nameAndAge(page);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
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
    fixture.finishPack();
    await fixture.page.close();
  }
});

test("name and age survive key save, renderer recreation and native download; Continue preserves the transfer", async () => {
  const fixture = await mount();
  try {
    const { page, operations } = fixture;
    await nameAndAge(page);
    await page
      .getByLabel("OpenAI", { exact: true })
      .fill("fixture-key-never-persisted");
    assert.equal(await cpuDownload(page).isEnabled(), false);
    assert.equal(
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .isEnabled(),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
          "fixture-key-never-persisted",
        ),
      ),
      false,
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByText("Change saved. Local services are ready.", { exact: true })
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
    assert.equal(
      await page.getByLabel("OpenAI", { exact: true }).inputValue(),
      "",
    );
    await cpuDownload(page).click();
    await page.getByLabel("OpenAI", { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('input[type="password"]')?.disabled === true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .isEnabled(),
      true,
    );
    // Native state outlives the renderer, while unfinished onboarding remains on setup.
    await page.reload();
    await page.waitForFunction(
      () => document.querySelector('input[type="password"]')?.disabled === true,
    );
    assert.equal(
      await page.getByLabel("Display name", { exact: true }).inputValue(),
      "Ada Lovelace",
    );
    assert.equal(
      await page.getByLabel("I am 18 or older", { exact: true }).isChecked(),
      true,
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText("Setup complete", { exact: true }).waitFor();
    assert.deepEqual(operations, [
      { method: "credentials.apply" },
      { method: "install", id: "parakeet-stt" },
    ]);
    assert.equal(fixture.packs[0].state, "downloading");
  } finally {
    fixture.finishPack();
    await fixture.page.close();
  }
});

test("discard permits download and failed native activation restores the unfinished draft for retry", async () => {
  const fixture = await mount();
  try {
    const { page, packs } = fixture;
    await nameAndAge(page);
    await page
      .getByLabel("OpenAI", { exact: true })
      .fill("fixture-discarded-key");
    assert.equal(await cpuDownload(page).isEnabled(), false);
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent?.includes("Download speech recognition") &&
          !button.disabled,
      ),
    );
    assert.equal(await cpuDownload(page).isEnabled(), true);
    packs[0].state = "failed";
    packs[0].error = "activation_failed";
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
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (button) =>
          button.textContent?.includes("Retry speech download") &&
          !button.disabled,
      ),
    );
    assert.equal(
      await page.getByRole("button", { name: /Retry/u }).isEnabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Continue", exact: true })
        .isEnabled(),
      true,
    );
  } finally {
    fixture.finishPack();
    await fixture.page.close();
  }
});

test("credential removal and a failed-save retry also retain the unfinished setup fields", async () => {
  const fixture = await mount();
  try {
    const { page, statuses, operations } = fixture;
    await nameAndAge(page);
    statuses[0].configured = true;
    statuses[0].updatedAt = "2026-09-28T00:00:00Z";
    statuses[0].error = "runtime_busy";
    await page.reload();
    await page.getByText(/OpenAI: The key was not changed/u).waitFor();
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
    await page
      .getByText("Change saved. Local services are ready.", { exact: true })
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
    assert.equal(
      await page.getByLabel("OpenAI", { exact: true }).inputValue(),
      "",
    );
    assert.equal(statuses[0].configured, false);
    assert.deepEqual(operations, [{ method: "credentials.apply" }]);
  } finally {
    fixture.finishPack();
    await fixture.page.close();
  }
});
