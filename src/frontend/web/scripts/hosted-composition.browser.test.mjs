import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer, loadConfigFromFile } from "vite";
import { BROWSER_STEP_TIMEOUT_MS } from "./fixtures/browser-timeouts.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = "tests/fixtures/hosted-composition";
const capabilities = {
  schema_version: 2,
  runtime_kind: "hosted",
  chat: true,
  anima_creation: false,
  chat_file_uploads: false,
  provider_credentials: false,
  model_configuration: false,
  model_selection: true,
  model_role_selection: true,
  local_filesystem_administration: false,
  native_features: false,
  offline_speech_enabled: false,
  offline_speech_asset_version: null,
  offline_speech_gpu_asset_version: null,
  companion_safety: {
    enabled: true,
    ai_notice_enabled: true,
    crisis_detection_enabled: true,
    operator_reminder_hours: 1,
  },
  user_file_processing: {
    enabled: false,
    worker_state: "disabled",
    supported_extensions: [],
    last_heartbeat_at: null,
    pack_id: null,
  },
  web_search: { configuration: false, configured: false },
};
let server, browser, origin;
before(async () => {
  const shared = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    path.join(webRoot, "vite.config.ts"),
  );
  server = await createServer({
    configFile: false,
    root: webRoot,
    cacheDir: path.join(webRoot, "node_modules/.vite/hosted-composition-tests"),
    publicDir: false,
    logLevel: "error",
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"fixture"',
      __CLIENT_PARAKEET_MODELS__: JSON.stringify({
        source: "asset-store",
        baseUrl: "/onnx/models/parakeet",
        webgpuBaseUrl: "/onnx/models/parakeet-webgpu",
      }),
    },
    // Some tests reach the app's own entry, which imports Zod's runtime
    // config. Scan it at startup too: a dependency found only after the
    // first page loads makes Vite re-bundle and reload mid-test on a cold
    // cache, as in CI.
    optimizeDeps: {
      entries: [
        path.join(webRoot, fixture, "main.tsx"),
        path.join(webRoot, "src/main.local.tsx"),
      ],
    },
    resolve: shared.config.resolve,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
      fs: {
        allow: [path.resolve(webRoot, "../../.."), path.resolve(webRoot, "..")],
      },
    },
  });
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function mount(
  route = "/",
  state = "active",
  viewport = { width: 1280, height: 800 },
  {
    utilities = false,
    loseFirstSetupReply = false,
    accountUrl = true,
    // Tabs opened in one browser context share storage and tab broadcasts.
    context = null,
    // Advertise browser telemetry, answering its posts with this status ("hang" never answers).
    telemetry = null,
    // Expose an embedded desktop bridge, as Electron's preload does.
    desktop = false,
  } = {},
) {
  const page = context
    ? await context.newPage()
    : await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls = [];
  const telemetryPosts = [];
  const setupKeys = [];
  const runtimeCapabilities = telemetry
    ? { ...capabilities, browser_telemetry: { path: "/api/telemetry" } }
    : capabilities;
  let csrf = "fixture-session-one";
  let generation = "fixture-session-generation-one";
  let offline = false;
  let logoutStatus = 200;
  let loginStatus = 200;
  await page.addInitScript(() => {
    window.microphoneStops = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop: () => {
                window.microphoneStops++;
              },
            },
          ],
        }),
      },
    });
  });
  if (desktop)
    await page.addInitScript(() => {
      window.animamaDesktop = { isDesktop: true, version: 2 };
    });
  // Every telemetry post is recorded, advertised or not, so silence is observable.
  await page.route("**/api/telemetry/**", async (requestRoute) => {
    const request = requestRoute.request();
    telemetryPosts.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      headers: request.headers(),
      body: request.postData(),
    });
    if (telemetry?.status === "hang") return;
    await requestRoute.fulfill({ status: telemetry?.status ?? 204 });
  });
  if (utilities)
    await page.addInitScript(() => {
      window.pendingPipWindows = [];
      window.createdPipWindows = [];
      Object.defineProperty(window, "documentPictureInPicture", {
        configurable: true,
        value: {
          requestWindow: () => {
            const popup = window.open("about:blank", "fixture-pip");
            window.createdPipWindows.push(popup);
            return new Promise((resolve) =>
              window.pendingPipWindows.push(() => resolve(popup)),
            );
          },
        },
      });
    });
  await page.route("**/v1/**", async (requestRoute) => {
    const request = requestRoute.request();
    const url = new URL(request.url());
    calls.push({
      path: url.pathname,
      method: request.method(),
      headers: request.headers(),
    });
    let data;
    if (url.pathname === "/v1/hosted/runtime-context")
      if (offline) return requestRoute.abort("internetdisconnected");
      else
        data = {
          schema_version: 1,
          state,
          user_id: state === "active" ? "fixture-owner" : null,
          csrf_token: csrf,
          recovery_session_id: generation,
          capabilities: runtimeCapabilities,
          ...(accountUrl ? { account_url: `${origin}/central-account` } : {}),
        };
    else if (url.pathname === "/v1/runtime-capabilities")
      data = runtimeCapabilities;
    else if (url.pathname === "/v1/hosted/bootstrap:ensure") {
      setupKeys.push(JSON.parse(request.postData() ?? "{}").idempotency_key);
      if (loseFirstSetupReply && setupKeys.length === 1)
        return requestRoute.abort("connectionreset");
      // The server-owned setup completes the account.
      state = "active";
      data = { state: "active", ready: true, failed_steps: [] };
    } else if (url.pathname === "/v1/hosted/events")
      return requestRoute.fulfill({
        contentType: "text/event-stream",
        body: "event: ready\ndata: {}\n\n",
      });
    else if (url.pathname === "/v1/hosted/quotas")
      data = {
        turns: { used: 2, limit: 20 },
        chats: { used: 1, limit: 10 },
        storage_bytes: { used: 1024, limit: 4096 },
        resets_at: "2030-01-01T00:00:00Z",
      };
    else if (url.pathname === "/v1/fixture-pending") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      data = { private: "old-result" };
    } else if (url.pathname.endsWith("/profile"))
      data = { display_name: "Fixture account" };
    else if (url.pathname.endsWith("/settings"))
      data = { theme: "system", preferences: {} };
    else if (url.pathname === "/v1/animas" || url.pathname === "/v1/chats")
      data = [];
    else data = {};
    try {
      await requestRoute.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    } catch {
      /* A session abort may close a deliberately delayed route. */
    }
  });
  await page.route("**/api/cloud/auth/**", async (requestRoute) => {
    const request = requestRoute.request();
    calls.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      headers: request.headers(),
      body: request.postData(),
    });
    const login = request.url().endsWith("/login");
    const status = login ? loginStatus : logoutStatus;
    // A successful logout ends the fixture's Cloud session, and so does a
    // successful login start; a failed login start leaves it live.
    if (status === 200) state = "session_required";
    await requestRoute.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status !== 200
          ? { error: "identity_unavailable" }
          : login
            ? { authorization_url: "https://identity.example.test/sign-in" }
            : { ok: true },
      ),
    });
  });
  await page.goto(
    `${origin}/${fixture}/index.html?route=${encodeURIComponent(route)}${utilities ? "&utilities=1" : ""}`,
  );
  try {
    await page.waitForFunction(
      () =>
        window.hostedFixture &&
        window.hostedFixture.current().status !== "loading",
      null,
      { timeout: 15000 },
    );
  } catch (error) {
    throw new Error(
      `${error.message}; browser errors: ${JSON.stringify(errors)}; requests: ${JSON.stringify(calls)}`,
    );
  }
  return {
    page,
    calls,
    telemetryPosts,
    errors,
    setupKeys,
    reauthenticate: () => {
      state = "active";
      csrf = "fixture-session-two";
      generation = "fixture-session-generation-two";
    },
    offline: (value) => {
      offline = value;
    },
    setState: (value) => {
      state = value;
    },
    setLogoutStatus: (value) => {
      logoutStatus = value;
    },
    setLoginStatus: (value) => {
      loginStatus = value;
    },
  };
}

/** Reloads serve the already-transformed fixture at its history URL. */
async function serveFixtureOnReload(page) {
  await page.route(`${origin}/`, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const response = await route.fetch({
      url: `${origin}/${fixture}/index.html`,
    });
    const html = (await response.text()).replace(
      'src="./main.tsx"',
      `src="/${fixture}/main.tsx"`,
    );
    await route.fulfill({ response, body: html });
  });
}

test("a signed-in first use sets up its account automatically, replaying the key after a lost reply", async () => {
  const { page, setupKeys } = await mount(
    "/",
    "bootstrap_required",
    undefined,
    {
      loseFirstSetupReply: true,
    },
  );
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    assert.equal(setupKeys.length, 2);
    assert.equal(setupKeys[1], setupKeys[0]);
  } finally {
    await page.close();
  }
});

test("an open view repairs a newly required account setup and keeps its session", async () => {
  const fixture = await mount();
  const { page, setupKeys } = fixture;
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    await page.evaluate(() => window.hostedFixture.startPrivateWork());
    const first = await page.evaluate(() => window.hostedFixture.current());
    fixture.setState("bootstrap_required");
    await page.evaluate(() => window.hostedFixture.refresh());
    await page.waitForFunction(
      () =>
        window.hostedFixture.current().status === "ready" &&
        !window.hostedFixture.current().reconnecting,
    );
    assert.equal(setupKeys.length, 1);
    const current = await page.evaluate(() => window.hostedFixture.current());
    assert.equal(current.key, first.key);
    assert.equal(current.privateData, "old-private-data");
    assert.equal(
      await page.evaluate(() => window.hostedFixture.draft().operationId),
      "fixture-operation",
    );
  } finally {
    await page.close();
  }
});

test("transient context failure preserves the original draft and fences dispatch until a successful refresh", async () => {
  const fixture = await mount();
  const { page, calls } = fixture;
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    await page.evaluate(() => window.hostedFixture.startPrivateWork());
    const first = await page.evaluate(() => window.hostedFixture.current().key);
    fixture.offline(true);
    await page.evaluate(() => window.hostedFixture.refresh());
    await page
      .getByRole("status")
      .filter({ hasText: "Reconnecting to Animama" })
      .waitFor();
    const before = calls.filter((call) => call.method === "POST").length;
    const fault = await page.evaluate(async () => {
      try {
        await window.hostedFixture.mutate();
      } catch (error) {
        return error.message;
      }
    });
    assert.match(fault, /reconnecting/);
    assert.equal(calls.filter((call) => call.method === "POST").length, before);
    assert.equal(
      await page.evaluate(() => window.hostedFixture.draft().operationId),
      "fixture-operation",
    );
    assert.equal(
      await page.evaluate(() => window.hostedFixture.current().key),
      first,
    );
    fixture.offline(false);
    await page.evaluate(() => window.hostedFixture.refresh());
    assert.equal(
      await page.evaluate(() => window.hostedFixture.current().reconnecting),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.hostedFixture.draft().operationId),
      "fixture-operation",
    );
  } finally {
    await page.close();
  }
});

test("a real same-tab reload recovers the original ambiguous operation and sign-out purges older hosted namespaces", async () => {
  const { page } = await mount();
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    await page.evaluate(() => window.hostedFixture.startPrivateWork());
    const first = await page.evaluate(() => window.hostedFixture.current().key);
    await serveFixtureOnReload(page);
    await page.reload();
    await page.getByText("Your Animas will appear here").waitFor();
    assert.equal(
      await page.evaluate(() => window.hostedFixture.current().key),
      first,
    );
    const recovered = await page.evaluate(() => window.hostedFixture.draft());
    assert.equal(recovered.operationId, "fixture-operation");
    assert.deepEqual(recovered.form, { text: "private-draft" });
    await page.evaluate(() => {
      localStorage.setItem(
        "animama:action-editor:hosted%3Aold-tab:gesture:fixture-draft",
        "private",
      );
      localStorage.setItem(
        "animama.package-import.v1.hosted:old-tab",
        "private receipt",
      );
    });
    await page.evaluate(() => window.hostedFixture.signOut());
    assert.deepEqual(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.includes("hosted")),
      ),
      [],
    );
  } finally {
    await page.close();
  }
});

test("leaving the companion route closes a late browser PiP window without moving private DOM", async () => {
  const { page } = await mount("/", "active", undefined, { utilities: true });
  await page
    .getByRole("button", { name: "Open browser PiP", exact: true })
    .click();
  await page.waitForFunction(() => window.pendingPipWindows.length === 1);
  await page
    .getByRole("button", { name: "Leave companion route", exact: true })
    .click();
  await page.getByText("Companion route ended", { exact: true }).waitFor();
  await page.evaluate(() => window.pendingPipWindows[0]());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  assert.equal(
    await page.evaluate(() => window.createdPipWindows[0].closed),
    true,
  );
  assert.equal(await page.locator("#utility-private-surface").count(), 0);
  await page.close();
});

test("browser fullscreen and PiP preserve the private companion host until closure", async () => {
  const { page } = await mount("/", "active", undefined, { utilities: true });
  await page
    .getByRole("button", { name: "Enter browser fullscreen", exact: true })
    .click();
  await page.waitForFunction(
    () => document.fullscreenElement?.id === "utility-private-surface",
  );
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.fullscreenElement === null);
  await page
    .getByRole("button", { name: "Open browser PiP", exact: true })
    .click();
  await page.waitForFunction(() => window.pendingPipWindows.length === 1);
  await page.evaluate(() => window.pendingPipWindows[0]());
  await page.waitForFunction(() =>
    window.createdPipWindows[0].document.body.querySelector(
      "#utility-private-surface",
    ),
  );
  await page
    .getByRole("button", { name: "Close browser PiP", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.createdPipWindows[0].closed),
    true,
  );
  assert.equal(await page.locator("#utility-private-surface").count(), 1);
  await page.close();
});

test("common hosted shell shows a useful empty roster, account and usage at desktop and narrow widths", async () => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const { page, calls } = await mount("/", "active", viewport);
    await page.getByText("Your Animas will appear here").waitFor();
    assert.equal(
      await page.getByRole("link", { name: "Open Library" }).count(),
      1,
    );
    {
      if (viewport.width < 768)
        await page.getByRole("button", { name: "Open sidebar" }).click();
      await page.getByRole("button", { name: "Fixture account" }).click();
      await page
        .getByRole("menuitem", { name: "Account", exact: true })
        .click();
      assert.deepEqual(
        await page.evaluate(
          () => window.hostedFixture.observations.navigations,
        ),
        [`${origin}/central-account`],
      );
      await page.getByRole("menuitem", { name: "Usage and limits" }).click();
      await page
        .getByRole("dialog")
        .getByText("Chat turns", { exact: true })
        .waitFor();
      await page
        .getByRole("dialog")
        .getByText("Storage bytes", { exact: true })
        .waitFor();
      assert.equal(
        calls.some((call) => call.path === "/v1/hosted/quotas"),
        true,
      );
    }
    assert.equal(
      calls.some(
        (call) =>
          /runtime-context$/.test(call.path) && !call.path.includes("/hosted/"),
      ),
      false,
    );
    assert.equal(
      calls.some((call) => call.path.includes("/runtime/bootstrap")),
      false,
    );
    await page.close();
  }
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  for (const dismissal of ["Escape", "Close"]) {
    test(`Usage modal dismissal by ${dismissal} restores navigation at ${viewport.width}px`, async () => {
      const { page } = await mount("/", "active", viewport);
      try {
        await page.getByText("Your Animas will appear here").waitFor();
        if (viewport.width < 768)
          await page.getByRole("button", { name: "Open sidebar" }).click();
        await page.getByRole("button", { name: "Fixture account" }).click();
        await page.getByRole("menuitem", { name: "Usage and limits" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("Chat turns", { exact: true }).waitFor();
        if (dismissal === "Escape") await page.keyboard.press("Escape");
        else
          await dialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
        await dialog.waitFor({ state: "detached" });

        // A dismissed modal must release the page for ordinary pointer navigation.
        // Playwright retries the hit-target check until this bound, so a page the
        // modal leaves blocked still fails; the bound allows for slow CI runners.
        await page
          .getByRole("link", { name: "Open Library" })
          .click({ timeout: 10_000 });
        assert.equal(new URL(page.url()).pathname, "/library");
      } finally {
        await page.close();
      }
    });
  }
}

test("six excluded direct routes render their reason without issuing product mutations", async () => {
  for (const [route, reason] of [
    ["/animas/new", "Creating Animas"],
    ["/attachments", "Chat attachments"],
    ["/documents", "Document ingestion"],
    ["/providers", "Provider connections"],
    ["/filesystem", "Local filesystem"],
    ["/desktop/pip/fixture", "desktop application"],
  ]) {
    const { page, calls } = await mount(route);
    try {
      await page
        .getByText(reason, { exact: false })
        .first()
        .waitFor({ timeout: BROWSER_STEP_TIMEOUT_MS });
    } catch (error) {
      throw new Error(
        `${route}: ${error.message}; content: ${await page.locator("body").innerText()}; location: ${page.url()}`,
      );
    }
    assert.equal(
      calls.some((call) => call.method !== "GET"),
      false,
    );
    await page.close();
  }
});

test("an empty hosted roster stays useful when opened directly", async () => {
  const { page } = await mount("/animas");
  await page
    .getByText("Your Animas will appear here")
    .waitFor({ timeout: BROWSER_STEP_TIMEOUT_MS });
  assert.equal(
    await page.getByRole("link", { name: "Open Library" }).count(),
    1,
  );
  assert.equal(new URL(page.url()).pathname, "/animas");
  await page.close();
});

test("common rejected admission states withhold the private shell", async () => {
  for (const [state, title] of [
    ["session_required", "Sign in to Animama"],
    ["ineligible", "Account access is not available"],
    ["paused", "Account access is restricted"],
    ["recovery", "Your account needs recovery"],
    ["identity_unavailable", "Runtime unavailable"],
  ]) {
    const { page, calls } = await mount("/library", state);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.equal(
      calls.some(
        (call) =>
          call.path === "/v1/animas" || call.path === "/v1/users/me/settings",
      ),
      false,
    );
    if (state === "paused") {
      await page.getByRole("button", { name: "Account", exact: true }).click();
      assert.deepEqual(
        await page.evaluate(
          () => window.hostedFixture.observations.navigations,
        ),
        [`${origin}/central-account`],
      );
    }
    await page.close();
  }
});

test("an idle tab whose events stream is cut after each ready reads the runtime context only on load", async () => {
  const { page, calls } = await mount();
  const count = (path) => calls.filter((call) => call.path === path).length;
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    // The fixture's events reply ends right after `ready`, as a proxy cutting the
    // stream would, so the tab reconnects about once a second.
    await page.waitForTimeout(6_000);
    assert.ok(count("/v1/hosted/events") >= 4);
    assert.equal(count("/v1/hosted/runtime-context"), 1);
  } finally {
    await page.close();
  }
});

test("account controls stay hidden without a central account URL", async () => {
  const restricted = await mount("/library", "paused", undefined, {
    accountUrl: false,
  });
  try {
    await restricted.page
      .getByRole("heading", { name: "Account access is restricted" })
      .waitFor();
    await restricted.page
      .getByRole("button", { name: "Sign out", exact: true })
      .waitFor();
    assert.equal(
      await restricted.page
        .getByRole("button", { name: "Account", exact: true })
        .count(),
      0,
    );
  } finally {
    await restricted.page.close();
  }
  const admitted = await mount("/", "active", undefined, { accountUrl: false });
  try {
    await admitted.page.getByText("Your Animas will appear here").waitFor();
    await admitted.page
      .getByRole("button", { name: "Fixture account" })
      .click();
    await admitted.page
      .getByRole("menuitem", { name: "Usage and limits" })
      .waitFor();
    assert.equal(
      await admitted.page
        .getByRole("menuitem", { name: "Account", exact: true })
        .count(),
      0,
    );
  } finally {
    await admitted.page.close();
  }
});

test("sign-out disposes private work and same-owner reauthentication has an empty new lifetime", async () => {
  const { page, calls, reauthenticate } = await mount();
  await page.getByText("Your Animas will appear here").waitFor();
  const first = await page.evaluate(() => window.hostedFixture.current().key);
  await page.evaluate(() => window.hostedFixture.startPrivateWork());
  await page.evaluate(() => window.hostedFixture.signOut());
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page.waitForFunction(
    () => window.hostedFixture.observations.requestAborted,
  );
  const ended = await page.evaluate(() => ({
    ...window.hostedFixture.observations,
    microphoneStops: window.microphoneStops,
    drafts: Object.keys(localStorage).filter((key) =>
      key.startsWith("animama:action-editor:"),
    ),
  }));
  assert.equal(ended.lateData, false);
  assert.equal(ended.workerStopped, true);
  assert.equal(ended.microphoneStops, 1);
  assert.deepEqual(ended.drafts, []);
  const logout = calls.find((call) => call.path.endsWith("/logout"));
  assert.equal(logout.headers["x-animama-csrf"], "fixture-session-one");
  assert.equal(logout.headers.authorization, undefined);
  reauthenticate();
  await page.evaluate(() => window.hostedFixture.reauthenticate());
  await page.getByText("Your Animas will appear here").waitFor();
  const current = await page.evaluate(() => window.hostedFixture.current());
  assert.notEqual(current.key, first);
  assert.equal(current.privateData, undefined);
  await page.close();
});

test("awaited hosted sign-out purges all hosted creator stores and retains local installation drafts", async () => {
  const { page, reauthenticate } = await mount();
  await page.getByText("Your Animas will appear here").waitFor();
  const first = await page.evaluate(() => window.hostedFixture.current().key);
  const others = ["installation-fixture", "hosted:previous-tab"];
  const before = await page.evaluate(
    async ({ first, others }) => {
      const writes = await Promise.all(
        [first, ...others].map((key) =>
          window.hostedFixture.writeCreatorRecovery(key),
        ),
      );
      localStorage.setItem(`device-pref:${first}`, "retain");
      localStorage.setItem("public-model-cache-fixture", "retain");
      return {
        writes,
        records: await window.hostedFixture.creatorRecoveryRecords(),
      };
    },
    { first, others },
  );
  assert(before.writes.flat().every(({ stored }) => stored));
  for (const records of before.records) assert.equal(records.length, 3);
  assert(
    before.records[1].some(({ privateBytes }) =>
      privateBytes.includes("private avatar draft"),
    ),
  );
  assert(
    before.records[2].some(({ privateBytes }) =>
      privateBytes.includes("private scene draft"),
    ),
  );

  await page.evaluate(() => window.hostedFixture.signOut());
  const after = await page.evaluate(async () => ({
    records: await window.hostedFixture.creatorRecoveryRecords(),
    preferences: Object.values(localStorage).filter(
      (value) => value === "retain",
    ),
  }));
  for (const records of after.records)
    assert.deepEqual(records.map(({ userId }) => userId).sort(), [
      "installation-fixture",
    ]);
  assert.equal(after.preferences.length, 2);
  const late = await page.evaluate(
    (key) => window.hostedFixture.writeCreatorRecovery(key, "late"),
    first,
  );
  assert(late.every(({ stored }) => stored === false));
  reauthenticate();
  await page.evaluate(() => window.hostedFixture.reauthenticate());
  const next = await page.evaluate(() => window.hostedFixture.current().key);
  assert.notEqual(next, first);
  const newWrites = await page.evaluate(
    (key) => window.hostedFixture.writeCreatorRecovery(key, "new-session"),
    next,
  );
  assert(newWrites.every(({ stored }) => stored));
  const records = await page.evaluate(() =>
    window.hostedFixture.creatorRecoveryRecords(),
  );
  for (const rows of records)
    assert(!rows.some(({ userId }) => userId === first));
  await page.close();
});

test("hosted sign-out waits for already-running recovery writes and fences queued writes and fallback resurrection", async () => {
  for (const failRunningWrite of [false, true]) {
    const { page } = await mount();
    await page.getByText("Your Animas will appear here").waitFor();
    await page.evaluate(async () => {
      const key = window.hostedFixture.current().key;
      await window.hostedFixture.writeCreatorRecovery(key);
      const open = indexedDB.open.bind(indexedDB);
      window.heldRecoveryOpens = [];
      window.restoreRecoveryOpen = () => {
        indexedDB.open = open;
      };
      indexedDB.open = (...args) => {
        const request = open(...args);
        return new Proxy(request, {
          get: (target, property) => Reflect.get(target, property, target),
          set: (target, property, value) => {
            if (property === "onsuccess") {
              target.onsuccess = () =>
                window.heldRecoveryOpens.push((fail) => {
                  if (fail) {
                    target.result.close();
                    target.onerror(new Event("error"));
                  } else value();
                });
            } else target[property] = value;
            return true;
          },
        });
      };
      window.runningRecovery = window.hostedFixture.queueCreatorRecovery(key);
      window.retiredRecoveryKey = key;
    });
    await page.waitForFunction(() => window.heldRecoveryOpens.length === 3);
    const remoteLogout = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/cloud/auth/logout" &&
        response.request().method() === "POST",
    );
    await page.evaluate(() => {
      window.signOutSettled = false;
      window.pendingSignOut = window.hostedFixture.signOut().then(() => {
        window.signOutSettled = true;
      });
    });
    const logoutResponse = await remoteLogout;
    assert.equal(logoutResponse.status(), 200);
    assert.deepEqual(await logoutResponse.json(), { ok: true });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
    );
    assert.equal(await page.evaluate(() => window.signOutSettled), false);
    assert.equal(
      await page.evaluate(() => window.hostedFixture.current().status),
      "sign-in-required",
    );
    const queuedWrites = await page.evaluate(async (fail) => {
      window.restoreRecoveryOpen();
      for (const release of window.heldRecoveryOpens) release(fail);
      const [writes] = await Promise.all([
        window.runningRecovery,
        window.pendingSignOut,
      ]);
      return writes;
    }, failRunningWrite);
    assert(queuedWrites.flat().every(({ stored }) => stored === false));
    let records = await page.evaluate(() =>
      window.hostedFixture.creatorRecoveryRecords(),
    );
    assert.deepEqual(records, [[], [], []]);
    const fallback = await page.evaluate(async () => {
      const open = indexedDB.open;
      indexedDB.open = () => {
        throw new Error("Unavailable storage");
      };
      try {
        const writes = await window.hostedFixture.writeCreatorRecovery(
          window.retiredRecoveryKey,
          "fallback",
        );
        return {
          writes,
          keys: Object.keys(localStorage).filter((key) =>
            key.includes(encodeURIComponent(window.retiredRecoveryKey)),
          ),
        };
      } finally {
        indexedDB.open = open;
      }
    });
    assert(fallback.writes.every(({ stored }) => stored === false));
    assert.deepEqual(fallback.keys, []);
    records = await page.evaluate(() =>
      window.hostedFixture.creatorRecoveryRecords(),
    );
    assert.deepEqual(records, [[], [], []]);
    await page.close();
  }
});

test("a failed remote sign-out stays retryable across focus and reload until it finishes", async () => {
  const fixture = await mount();
  const { page, calls } = fixture;
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    fixture.setLogoutStatus(503);
    await page.evaluate(() => window.hostedFixture.signOut());
    const heading = page.getByRole("heading", {
      name: "Sign-out did not complete",
    });
    await heading.waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.evaluate(() => window.hostedFixture.refresh());
    await heading.waitFor();
    // The Cloud session is still live, so a reload must not readmit it.
    await serveFixtureOnReload(page);
    await page.reload();
    await heading.waitFor();
    assert.equal(
      await page.evaluate(() => window.hostedFixture.current().status),
      "sign-in-required",
    );
    fixture.setLogoutStatus(200);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in to Animama" }).waitFor();
    const logouts = calls.filter((call) => call.path.endsWith("/logout"));
    assert.equal(logouts.length, 2);
    assert.equal(logouts[1].headers["x-animama-csrf"], "fixture-session-one");
  } finally {
    await page.close();
  }
});

test("a sign-in that cannot start from the sign-out retry view keeps that view across reload", async () => {
  const fixture = await mount();
  const { page } = fixture;
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    fixture.setLogoutStatus(503);
    await page.evaluate(() => window.hostedFixture.signOut());
    const heading = page.getByRole("heading", {
      name: "Sign-out did not complete",
    });
    await heading.waitFor();
    // Login cannot end the live session, so it starts no sign-in.
    fixture.setLoginStatus(503);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Sign-in could not be started" })
      .waitFor();
    await heading.waitFor();
    assert.deepEqual(
      await page.evaluate(() => window.hostedFixture.observations.navigations),
      [],
    );
    await serveFixtureOnReload(page);
    await page.reload();
    await heading.waitFor();
    assert.equal(
      await page.evaluate(() => window.hostedFixture.current().status),
      "sign-in-required",
    );
  } finally {
    await page.close();
  }
});

test("a tab signed out by another tab adopts a newer session when it is focused", async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  try {
    const first = await mount("/", "active", undefined, { context });
    const second = await mount("/", "active", undefined, { context });
    await second.page.getByText("Your Animas will appear here").waitFor();
    const before = await second.page.evaluate(
      () => window.hostedFixture.current().key,
    );
    await first.page.evaluate(() => window.hostedFixture.signOut());
    await second.page
      .getByRole("heading", { name: "Sign in to Animama" })
      .waitFor();
    // Someone signs in again in another tab before this one is used.
    second.reauthenticate();
    await second.page.bringToFront();
    await second.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await second.page.getByText("Your Animas will appear here").waitFor();
    assert.notEqual(
      await second.page.evaluate(() => window.hostedFixture.current().key),
      before,
    );
    assert.equal(
      second.calls.some((call) => call.path.endsWith("/login")),
      false,
    );
  } finally {
    await context.close();
  }
});

test("a failed sign-in callback shows an alert and sign-in returns to the same page", async () => {
  const { page, calls } = await mount(
    "/library?sign_in=failed",
    "session_required",
  );
  try {
    await page
      .getByRole("alert")
      .filter({ hasText: "Sign-in did not finish" })
      .waitFor();
    assert.equal(new URL(page.url()).search, "");
    assert.equal(new URL(page.url()).pathname, "/library");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForFunction(
      () => window.hostedFixture.observations.navigations.length === 1,
    );
    const login = calls.find((call) => call.path.endsWith("/login"));
    assert.deepEqual(JSON.parse(login.body), { return_path: "/library" });
  } finally {
    await page.close();
  }
});

test("speech workers answer again after a same-page sign-out and reauthentication", async () => {
  const { page, reauthenticate } = await mount();
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    const before = await page.evaluate(() =>
      window.hostedFixture.speechProbe(),
    );
    assert.match(before.parakeet, /not been loaded/);
    assert.match(before.smartTurn, /not been loaded/);
    await page.evaluate(() => window.hostedFixture.signOut());
    reauthenticate();
    await page.evaluate(() => window.hostedFixture.reauthenticate());
    await page.getByText("Your Animas will appear here").waitFor();
    // The ended session's workers were terminated; new ones must answer.
    const after = await page.evaluate(() => window.hostedFixture.speechProbe());
    assert.match(after.parakeet, /not been loaded/);
    assert.match(after.smartTurn, /not been loaded/);
  } finally {
    await page.close();
  }
});

const telemetryUuid = "123e4567-e89b-42d3-a456-426614174000";

/** Records metrics, raises an uncaught error and a rejection, then hides the page. */
async function produceTelemetry(page) {
  await page.evaluate((id) => {
    window.hostedFixture.recordMetrics(id);
    setTimeout(() => {
      throw new TypeError(
        `Send failed for person@example.com at ${location.origin}/v1/animas/${id}?draft=hello`,
      );
    });
    void Promise.reject(new Error(`chat ${id} was not saved`));
  }, telemetryUuid);
  // Let the error events dispatch before the page-hide flush reads the queue.
  await page.waitForTimeout(100);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
}

test("without the runtime capability the page registers no exporter and sends no telemetry", async () => {
  const { page, telemetryPosts } = await mount();
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    await produceTelemetry(page);
    await page.waitForTimeout(500);
    assert.deepEqual(telemetryPosts, []);
  } finally {
    await page.close();
  }
});

test("an advertised capability exports sanitized metrics and an injected error as OTLP JSON", async () => {
  const { page, telemetryPosts } = await mount("/", "active", undefined, {
    telemetry: { status: 204 },
  });
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    await produceTelemetry(page);
    const deadline = Date.now() + BROWSER_STEP_TIMEOUT_MS;
    while (telemetryPosts.length < 2 && Date.now() < deadline)
      await page.waitForTimeout(50);
    const byPath = Object.fromEntries(
      telemetryPosts.map((post) => [post.path, post]),
    );
    assert.deepEqual(Object.keys(byPath).sort(), [
      "/api/telemetry/logs",
      "/api/telemetry/metrics",
    ]);
    for (const post of telemetryPosts) {
      assert.equal(post.method, "POST");
      assert.equal(post.headers["content-type"], "application/json");
      // The post belongs to the admitted Cloud session.
      assert.equal(post.headers["x-animama-csrf"], "fixture-session-one");
      for (const forbidden of [
        telemetryUuid,
        "person@example.com",
        "?draft",
        "draft=",
        new URL(origin).host,
      ])
        assert.ok(
          !post.body.includes(forbidden),
          `${post.path} contains ${forbidden}`,
        );
    }
    const metrics = JSON.parse(byPath["/api/telemetry/metrics"].body)
      .resourceMetrics[0].scopeMetrics[0].metrics;
    assert.deepEqual(metrics.map((metric) => metric.name).sort(), [
      "anima.webui.sse.duration",
      "anima.webui.ui.interactions",
    ]);
    const logs = JSON.parse(byPath["/api/telemetry/logs"].body).resourceLogs[0]
      .scopeLogs[0].logRecords;
    assert.deepEqual(logs.map((record) => record.body.stringValue).sort(), [
      "Send failed for <email> at /v1/animas/<id>",
      "chat <id> was not saved",
    ]);
  } finally {
    await page.close();
  }
});

test("the embedded desktop app never exports, even when the capability is advertised", async () => {
  const { page, telemetryPosts } = await mount("/", "active", undefined, {
    telemetry: { status: 204 },
    desktop: true,
  });
  try {
    await page.getByText("Your Animas will appear here").waitFor();
    await produceTelemetry(page);
    await page.waitForTimeout(500);
    assert.deepEqual(telemetryPosts, []);
  } finally {
    await page.close();
  }
});

for (const status of [503, "hang"])
  test(`a failing telemetry endpoint (${status}) leaves the UI responsive without queueing requests`, async () => {
    const { page, telemetryPosts } = await mount("/", "active", undefined, {
      telemetry: { status },
    });
    try {
      await page.getByText("Your Animas will appear here").waitFor();
      for (let round = 0; round < 5; round++) await produceTelemetry(page);
      // Each signal sends once; a failure or an unanswered post holds the rest back.
      await page.waitForTimeout(300);
      assert.ok(
        telemetryPosts.length <= 2,
        `sent ${telemetryPosts.length} requests`,
      );
      const started = Date.now();
      await page.evaluate(() => window.hostedFixture.recordMetrics("x"));
      await page.getByText("Your Animas will appear here").waitFor();
      assert.ok(Date.now() - started < 1_000);
      assert.equal(
        await page.evaluate(() => window.hostedFixture.current().status),
        "ready",
      );
    } finally {
      await page.close();
    }
  });
