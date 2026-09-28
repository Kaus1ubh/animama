import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = path.join(webRoot, "tests/fixtures/voice-clone-library");
const encoderId = "pocket-tts-voice-cloning-encoder";
const encoderPath = `/v1/model-assets/${encoderId}`;
const missing = {
  id: encoderId,
  status: "not_installed",
  size_bytes: 39_768_446,
  required_free_bytes: 39_768_446,
  media_type: "application/octet-stream",
  license_ref: "pocket-tts-voice-cloning",
};
const sample = Buffer.from("the complete original sample, including its tail");
let server;
let browser;
let origin;

before(async () => {
  server = await createServer({
    configFile: false,
    root: webRoot,
    cacheDir: path.join(
      webRoot,
      "node_modules/.vite/voice-clone-library-tests",
    ),
    publicDir: false,
    logLevel: "error",
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"test"',
    },
    optimizeDeps: { entries: [path.join(fixture, "main.tsx")] },
    resolve: {
      alias: [
        {
          find: "@/query/mutations/useVoiceCloneActions",
          replacement: path.join(fixture, "boundaries.ts"),
        },
        {
          find: /^\.\/catalog-builder$/,
          replacement: path.join(fixture, "boundaries.ts"),
        },
        { find: "@", replacement: path.join(webRoot, "src") },
        { find: "@web", replacement: path.join(webRoot, "src") },
      ],
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

test("download-only browsing downloads and removes a preset without changing voice selection", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.goto(`${origin}/tests/fixtures/voice-clone-library/picker.html`);
    await page.getByRole("button", { name: "Browse PocketTTS voices" }).click();
    assert.equal(
      await page.getByRole("button", { name: /^Select / }).count(),
      0,
    );
    assert.equal(await page.getByText("Included", { exact: true }).count(), 2);
    assert.deepEqual(
      await page.evaluate(() => window.voicePickerFixture.actions),
      [],
    );
    await page.getByLabel("Search PocketTTS voices").fill("Clara");
    await page
      .getByRole("button", { name: "Download Clara", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove Clara", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm removal of Clara", exact: true })
      .click();
    const result = await page.evaluate(() => window.voicePickerFixture);
    assert.equal(result.selected, "eve");
    assert.deepEqual(
      result.actions.map((item) => item.operation),
      ["download", "remove"],
    );
    assert.equal(result.actions[0].id, result.actions[1].id);
  } finally {
    await page.close();
  }
});

test("selection mode keeps independent download actions and keyboard voice selection", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(
      `${origin}/tests/fixtures/voice-clone-library/picker.html?selection`,
    );
    await page
      .getByRole("button", { name: "PocketTTS voice: Eve", exact: true })
      .click();
    await page.getByLabel("Search PocketTTS voices").fill("Clara");
    const download = page.getByRole("button", {
      name: "Download Clara",
      exact: true,
    });
    await download.focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => window.voicePickerFixture.selected),
      "eve",
    );
    await page
      .getByRole("button", { name: "Select Clara", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(
      await page.evaluate(() =>
        window.voicePickerFixture.actions.map((item) => item.operation),
      ),
      ["download", "select"],
    );
    assert.equal(
      await page.evaluate(() => window.voicePickerFixture.selected),
      "clara",
    );
  } finally {
    await page.close();
  }
});

/** Controlled HTTP states keep real query mutations while preventing model or content writes. */
async function mount() {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.setDefaultTimeout(10_000);
  const requests = [];
  let asset = { ...missing };
  let releaseInstall;
  const installReply = new Promise((resolve) => {
    releaseInstall = resolve;
  });
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requests.push({ method: request.method(), pathname });
    assert.ok(pathname.startsWith(encoderPath), `Unexpected API: ${pathname}`);
    if (request.method() === "POST") await installReply;
    await route.fulfill({ json: asset });
  });
  await page.goto(`${origin}/tests/fixtures/voice-clone-library/index.html`);
  await page.getByLabel("Upload custom voice sample").setInputFiles({
    name: "Narrator.wav",
    mimeType: "audio/wav",
    buffer: sample,
  });
  await page.getByRole("button", { name: "Clone voice", exact: true }).click();
  await page.getByRole("dialog", { name: "Download voice cloning?" }).waitFor();
  assert.equal(
    requests.filter((request) => request.method !== "GET").length,
    0,
  );
  return {
    page,
    requests,
    setState(status) {
      asset = { ...missing, status };
    },
    releaseInstall,
  };
}

test("explicit Download waits for verification then saves the same complete sample exactly once", async () => {
  const fixture = await mount();
  const { page, requests } = fixture;
  try {
    await Promise.all([
      page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`${encoderPath}:install`),
      ),
      page.getByRole("button", { name: "Download and clone" }).click(),
    ]);
    fixture.setState("downloading");
    fixture.releaseInstall();
    await page
      .getByText("Downloading voice cloning…", { exact: true })
      .first()
      .waitFor();
    assert.deepEqual(
      await page.evaluate(() => ({
        encoded: window.voiceCloneFixture.observations.encoded.length,
        saved: window.voiceCloneFixture.observations.saved.length,
      })),
      { encoded: 0, saved: 0 },
    );
    fixture.setState("installed");
    await page.waitForFunction(
      () => window.voiceCloneFixture.observations.saved.length === 1,
    );
    const result = await page.evaluate(async () => {
      const { preparations, encoded, saved, busy } =
        window.voiceCloneFixture.observations;
      return {
        preparations: preparations.length,
        sameFile: preparations.every((file) => file === encoded[0]),
        encoded: encoded.length,
        saves: saved.length,
        name: saved[0].descriptor.name,
        original: await saved[0].files[0].text(),
        busy: busy.at(-1),
      };
    });
    assert.deepEqual(result, {
      preparations: 2,
      sameFile: true,
      encoded: 1,
      saves: 1,
      name: "Narrator",
      original: sample.toString(),
      busy: false,
    });
    assert.equal(
      requests.filter((request) => request.method === "POST").length,
      1,
    );
    assert.equal(
      requests.filter((request) => request.method === "DELETE").length,
      0,
    );
    assert.equal(await page.getByLabel("Voice clone name").inputValue(), "");
  } finally {
    fixture.releaseInstall();
    await page.close();
  }
});

test("Close detaches during the install request without continuing preparation or removing shared bytes", async () => {
  const fixture = await mount();
  const { page, requests } = fixture;
  try {
    await Promise.all([
      page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`${encoderPath}:install`),
      ),
      page.getByRole("button", { name: "Download and clone" }).click(),
    ]);
    await page
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    fixture.setState("installed");
    const replied = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`${encoderPath}:install`),
    );
    fixture.releaseInstall();
    await replied;
    await page.waitForFunction(
      () => window.voiceCloneFixture.pendingMutations() === 0,
    );
    await page
      .getByRole("button", { name: "Clone voice", exact: true })
      .waitFor({ state: "visible" });
    const result = await page.evaluate(() => {
      const { preparations, encoded, saved, busy } =
        window.voiceCloneFixture.observations;
      return {
        preparations: preparations.length,
        encoded: encoded.length,
        saves: saved.length,
        busy: busy.at(-1),
      };
    });
    assert.deepEqual(result, {
      preparations: 1,
      encoded: 0,
      saves: 0,
      busy: false,
    });
    assert.equal(
      requests.filter((request) => request.method === "DELETE").length,
      0,
    );
    assert.equal(
      await page.getByLabel("Voice clone name").inputValue(),
      "Narrator",
    );
    assert.equal(
      await page.getByText("Narrator.wav", { exact: true }).count(),
      1,
    );
  } finally {
    fixture.releaseInstall();
    await page.close();
  }
});
