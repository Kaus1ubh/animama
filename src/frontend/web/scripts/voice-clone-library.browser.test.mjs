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
  files_total: 1,
  files_verified: 0,
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

test("compact picker keeps inline download, retry and cancel independent of selection", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    await page.goto(`${origin}/tests/fixtures/voice-clone-library/picker.html`);
    await page.getByRole("button", { name: "PocketTTS voice: Eve" }).click();
    await page
      .getByRole("img", { name: "Eve included", exact: true })
      .waitFor();
    assert.equal(await page.getByText("Included", { exact: true }).count(), 0);
    assert.deepEqual(
      await page.evaluate(() => window.voicePickerFixture.actions),
      [],
    );
    await page.getByLabel("Search PocketTTS voices").fill("Clara");
    const download = page.getByRole("button", {
      name: "Download Clara",
      exact: true,
    });
    const select = page.getByRole("button", {
      name: "Select Clara",
      exact: true,
    });
    // The popover zooms and slides in, so measure only after its open
    // animation finishes, and read both rows in one frame.
    await download.waitFor();
    await select.waitFor();
    const [downloadCenter, selectCenter] = await page
      .locator('[data-slot="popover-content"]')
      .evaluate(async (popover) => {
        await Promise.all(popover.getAnimations().map((item) => item.finished));
        return ["Download Clara", "Select Clara"].map((label) => {
          const box = popover
            .querySelector(`[aria-label="${label}"]`)
            .getBoundingClientRect();
          return box.top + box.height / 2;
        });
      });
    assert.ok(
      Math.abs(downloadCenter - selectCenter) < 2,
      "download action stays on the selection row",
    );
    assert.equal(await download.innerText(), "");
    await download.click();
    const cancel = page.getByRole("button", {
      name: "Cancel download Clara",
      exact: true,
    });
    assert.equal(await cancel.isEnabled(), true);
    assert.match(await cancel.getAttribute("title"), /Downloading 50%/);
    await page.evaluate(() =>
      window.voicePickerFixture.setDownloadState(
        "pocket-voice-clara",
        "failed",
      ),
    );
    await page.getByRole("button", { name: "Retry download Clara" }).click();
    await cancel.focus();
    await page.keyboard.press("Enter");
    await download.click();
    await page.evaluate(() =>
      window.voicePickerFixture.setDownloadState(
        "pocket-voice-clara",
        "installed",
      ),
    );
    await page
      .getByRole("img", { name: "Clara downloaded", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Remove Clara", exact: true })
        .count(),
      0,
    );
    const result = await page.evaluate(() => ({
      selected: window.voicePickerFixture.selected,
      actions: window.voicePickerFixture.actions,
    }));
    assert.equal(result.selected, "eve");
    assert.deepEqual(
      result.actions.map((item) => item.operation),
      ["download", "download", "cancel", "download"],
    );
    assert.equal(result.actions[0].id, result.actions[1].id);
  } finally {
    await page.close();
  }
});

test("picker filters expose keyboard gender tabs and Custom without selecting or downloading", async () => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.setDefaultTimeout(5_000);
  const modelRequests = [];
  page.on("request", (request) => {
    if (
      /\/(v1\/model-assets|onnx\/models|models\/pocket-tts)/u.test(
        request.url(),
      )
    )
      modelRequests.push(request.url());
  });
  try {
    await page.goto(
      `${origin}/tests/fixtures/voice-clone-library/picker.html?customvoices`,
    );
    await page.getByRole("button", { name: "PocketTTS voice: Eve" }).click();
    const all = page.getByRole("tab", { name: "All", exact: true });
    const female = page.getByRole("tab", { name: "Female", exact: true });
    const male = page.getByRole("tab", { name: "Male", exact: true });
    const recommended = page.getByRole("checkbox", {
      name: "Recommended only",
      exact: true,
    });
    const custom = page.getByRole("checkbox", { name: "Custom", exact: true });
    const narrator = page.getByRole("button", {
      name: "Select Narrator",
      exact: true,
    });
    const uploaded = page.getByRole("button", {
      name: "Custom (uploaded)",
      exact: true,
    });
    const search = page.getByLabel("Search PocketTTS voices");
    assert.equal(await all.getAttribute("aria-selected"), "true");
    assert.equal(await narrator.count(), 1);
    assert.equal(await uploaded.count(), 1);
    assert.equal(await page.getByText("40 voices", { exact: true }).count(), 1);
    await all.focus();
    await page.keyboard.press("ArrowRight");
    await page
      .getByRole("tab", { name: "Female", exact: true, selected: true })
      .waitFor();
    assert.equal(await female.getAttribute("aria-selected"), "true");
    assert.equal(await narrator.count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Select Paul", exact: true })
        .count(),
      0,
    );
    await recommended.click();
    assert.equal(
      await page
        .getByRole("button", { name: "Select Eve", exact: true })
        .count(),
      0,
    );
    await search.fill("Canadian");
    assert.equal(
      await page.getByRole("button", { name: /^Select / }).count(),
      1,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Select Azelma", exact: true })
        .count(),
      1,
    );
    await search.fill("");
    await male.click();
    assert.equal(
      await page
        .getByRole("button", { name: "Select Paul", exact: true })
        .count(),
      1,
    );
    await custom.click();
    assert.equal(await all.isEnabled(), false);
    assert.equal(await female.isEnabled(), false);
    assert.equal(await male.isEnabled(), false);
    assert.equal(await recommended.isEnabled(), false);
    assert.equal(await narrator.count(), 1);
    assert.equal(await uploaded.count(), 1);
    assert.equal(await page.getByText("2 voices", { exact: true }).count(), 1);
    assert.equal(
      await page
        .getByRole("button", { name: "Select Paul", exact: true })
        .count(),
      0,
    );
    await search.fill("narr");
    assert.equal(await narrator.count(), 1);
    assert.equal(await uploaded.count(), 0);
    assert.equal(await page.getByText("1 voice", { exact: true }).count(), 1);
    await search.fill("uploaded");
    assert.equal(await narrator.count(), 0);
    assert.equal(await uploaded.count(), 1);
    await search.fill("");
    await custom.click();
    assert.equal(await male.getAttribute("aria-selected"), "true");
    assert.equal(await recommended.isChecked(), true);
    assert.equal(await recommended.isEnabled(), true);
    assert.equal(await narrator.count(), 0);
    await all.click();
    await recommended.click();
    assert.equal(await narrator.count(), 1);
    const screenshots = process.env.ANIMAMA_PICKER_SCREENSHOTS;
    if (screenshots)
      await page.screenshot({
        path: path.join(screenshots, "voice-picker-filters-desktop.png"),
      });
    await page.setViewportSize({ width: 390, height: 844 });
    const searchBox = await search.boundingBox();
    for (const control of [all, female, male, recommended, custom]) {
      const box = await control.boundingBox();
      assert.ok(
        box.y >= searchBox.y + searchBox.height,
        "filters remain below search",
      );
      assert.ok(
        box.x >= 0 && box.x + box.width <= 390,
        "filter fits narrow picker",
      );
    }
    if (screenshots)
      await page.screenshot({
        path: path.join(screenshots, "voice-picker-filters-narrow.png"),
      });
    assert.deepEqual(
      await page.evaluate(() => window.voicePickerFixture.actions),
      [],
    );
    assert.equal(
      await page.evaluate(() => window.voicePickerFixture.selected),
      "eve",
    );
    assert.deepEqual(modelRequests, []);
  } finally {
    await page.close();
  }
});

test("compact picker keeps keyboard download and voice selection on narrow screens", async () => {
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
