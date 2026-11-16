import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { desktopRoot, frontendRoot, readJson, writeJson } from "./common.mjs";
import { packedFuseWire, readFuseWire, smokeCopyFuseWire } from "./fuses.mjs";
import {
  debuggingLaunchesRefused,
  eventually,
  profileUnused,
} from "./smoke-hardening.mjs";
import { classifySmokeRequest } from "./smoke-policy.mjs";

/** Runs in the renderer; verify the temporary key is gone from status only. */
export async function temporarySmokeProviderRemoved() {
  const status = (await window.animamaDesktop.credentials.list()).find(
    (entry) => entry.provider === "openai",
  );
  return Boolean(status) && !status.configured;
}

/** Credentials are supplied only for this explicit smoke journey; never load a developer .env. */
export function smokeProviderKey() {
  const provider = process.env.ANIMAMA_SMOKE_OPENAI_KEY;
  if (!provider || provider.length > 8192)
    throw new Error(
      "Set ANIMAMA_SMOKE_OPENAI_KEY for the bounded real chat smoke; missing provider coverage is not a pass.",
    );
  return provider;
}

/** Refuse a profile that already has Animama data; smoke never resets it. */
export function assertFreshProfile(paths, account) {
  for (const existing of paths)
    if (existsSync(existing))
      throw new Error(
        `This is not a fresh ${account} profile. Use a dedicated test account or fresh runner; smoke never resets existing app data.`,
      );
}

/** Join a cleanup instruction to any already reported. */
export function addCleanup(current, instruction) {
  return current ? `${current} ${instruction}` : instruction;
}

/**
 * Smoke checks of a fresh app's runtime capabilities: no optional download
 * started by itself, and the core app's upload processor is running without a
 * pack.
 */
export function desktopCapabilityChecks(capabilities) {
  return {
    no_automatic_optional_download:
      capabilities?.runtime_kind === "desktop" &&
      capabilities.offline_speech_enabled === false,
    core_upload_processing:
      capabilities?.user_file_processing?.enabled === true &&
      capabilities.user_file_processing.worker_state === "ready",
  };
}

/**
 * The installed-artifact smoke. The exact installed app is checked without
 * being debugged: its fuse wire, its sealed update policy, and a prompt exit
 * with no runtime for each debugging switch. The fresh-profile, required-name
 * journey then runs on a copy of it that only the smoke makes, with Node's
 * inspect switches turned on so the test driver can attach, and a throwaway
 * profile; both are deleted afterwards. Each platform supplies what differs:
 *
 * - `userData`: the canonical profile the installed app would create;
 * - `installed`, `executable` and `env`: the installed app and its minimal
 *   launch environment, whose `PATH` the app must keep;
 * - `fuseApp` and `runtime`: where the installed app's fuse wire and sealed
 *   runtime are; `updatePolicy`: the policy the runtime must carry;
 * - `install()`: verifies and installs the exact artifact, recording its
 *   runtime build ID and publisher signature in the report;
 * - `noInstalledProcesses()`: whether nothing runs from the installed app;
 * - `copyLocation()`: a new private `directory` outside the checkout for the
 *   copy, and the throwaway `profile` inside it;
 * - `copy(directory)`: makes the journey copy in `directory` and returns its
 *   `installed`, `executable`, `fuseApp`, `ownedChild(child)` (whether a
 *   recorded child runs the copy's runtime) and `noInstalledProcesses()`;
 * - `cleanup()` (optional): releases artifact resources, returning a failed
 *   step name or null; it may add to `report.cleanup_required`.
 *
 * Writes the sanitized smoke and network reports to `release/smoke-name`.
 */
export async function runSmokeJourney({ report, provider, platform }) {
  const output = path.join(desktopRoot, `release/smoke-${report.setup}`);
  mkdirSync(output, { recursive: true });
  let application;
  let providerMayBeSaved = false;
  let step = "artifact-verification";
  let origin;
  // The journey copy, its private directory and its throwaway profile.
  let work;
  let journey;
  let copyRemoved = false;
  const trace = [];
  const traceFailures = new Set();
  const evidence = (name, condition) => {
    report.checks[name] = Boolean(condition);
    if (!condition) throw new Error("check_failed");
  };
  const require = createRequire(path.join(frontendRoot, "package.json"));
  const { _electron } = require("playwright");
  const launch = async () => {
    const app = await _electron.launch({
      executablePath: journey.executable,
      env: journey.env,
      timeout: 120_000,
    });
    const state = path.join(journey.userData, "runtime/state.json");
    const recordNetwork = (url, method, phase, status) => {
      if (!origin && existsSync(state))
        origin = `http://127.0.0.1:${readJson(state).gatewayPort}`;
      if (!origin || trace.length >= 20_000) {
        if (trace.length >= 20_000) traceFailures.add("trace_limit");
        return;
      }
      const category = classifySmokeRequest(url, origin);
      trace.push({
        ...category,
        phase,
        ...(status === undefined ? {} : { status }),
        method: [
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
        ].includes(method)
          ? method
          : "OTHER",
      });
      if (category.forbidden) traceFailures.add("unexpected_renderer_network");
    };
    app
      .context()
      .on("request", (request) =>
        recordNetwork(request.url(), request.method(), "request"),
      );
    app
      .context()
      .on("response", (response) =>
        recordNetwork(
          response.url(),
          response.request().method(),
          "response",
          response.status(),
        ),
      );
    return app;
  };
  const readyPage = async () => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      for (const page of application.windows()) {
        const state = await page
          .evaluate(async () => {
            const bridge = window.animamaDesktop;
            return {
              role: bridge?.windowRole,
              runtime: await bridge?.runtime?.status(),
            };
          })
          .catch(() => null);
        if (state?.runtime?.state === "error")
          throw new Error("runtime_recovery");
        if (state?.role === "main" && state.runtime?.state === "ready") {
          origin = state.runtime.origin;
          if (new URL(page.url()).origin === origin) return page;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("startup_timeout");
  };
  const request = (page, url, options) =>
    page.evaluate(
      async ({ url, options }) => {
        const response = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            "X-Animama-CSRF": "1",
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error("smoke_api_failed");
        return response.json();
      },
      { url, options },
    );
  const observeChildren = () => {
    const record = readJson(
      path.join(journey.userData, "runtime/processes.json"),
    );
    evidence(
      "owned_child_paths",
      record.children.length >= 3 &&
        record.children.every((child) => journey.ownedChild(child)),
    );
    report.children = record.children.map((child) => ({
      role: child.name,
      executable: path.relative(journey.installed, child.executable),
    }));
  };
  const close = async () => {
    await application.close();
    application = undefined;
    const record = readJson(
      path.join(journey.userData, "runtime/processes.json"),
    );
    evidence("owned_children_stopped", record.children.length === 0);
    // Chromium's helper processes finish exiting shortly after the app.
    evidence(
      "no_owned_process_remains",
      eventually(journey.noInstalledProcesses),
    );
  };
  /** The owned FastAPI PID; a key change must apply without replacing it. */
  const fastapiPid = () =>
    readJson(
      path.join(journey.userData, "runtime/processes.json"),
    ).children.find((child) => child.name === "fastapi")?.pid;
  const cleanupProvider = async () => {
    if (!providerMayBeSaved) return;
    if (!application) application = await launch();
    const current = await readyPage();
    if (!(await current.evaluate(temporarySmokeProviderRemoved))) {
      await current.evaluate(() =>
        window.animamaDesktop.credentials.apply([{ provider: "openai" }]),
      );
      if (!(await current.evaluate(temporarySmokeProviderRemoved)))
        throw new Error("temporary_provider_cleanup_failed");
    }
    evidence("temporary_provider_removed", true);
    providerMayBeSaved = false;
  };
  try {
    await platform.install(evidence);
    step = "exact-artifact";
    evidence(
      "exact_fuse_wire",
      readFuseWire(platform.fuseApp) === packedFuseWire,
    );
    evidence(
      "sealed_update_policy",
      JSON.stringify(
        readJson(path.join(platform.runtime, "update-policy.json")),
      ) === JSON.stringify(platform.updatePolicy),
    );
    step = "debugging-switches";
    evidence(
      "debugging_switches_refused",
      debuggingLaunchesRefused({
        executable: platform.executable,
        env: platform.env,
        userData: platform.userData,
        noInstalledProcesses: platform.noInstalledProcesses,
      }),
    );
    step = "journey-copy";
    const location = platform.copyLocation();
    work = location.directory;
    const copy = platform.copy(work);
    evidence(
      "copy_fuse_wire",
      readFuseWire(copy.fuseApp) === smokeCopyFuseWire(),
    );
    const userData = location.profile;
    // A packaged app accepts this override only while its inspector runs.
    journey = {
      ...copy,
      userData,
      env: { ...platform.env, ANIMAMA_DESKTOP_DEV_USER_DATA: userData },
    };
    step = "fresh-launch";
    application = await launch();
    let page = await readyPage();
    // The copy runs from its throwaway profile, never the installed app's.
    evidence("canonical_profile_untouched", profileUnused(platform.userData));
    await page
      .getByRole("heading", { name: "What should Animama call you?" })
      .waitFor({ timeout: 60_000 });
    const initial = await request(page, "/v1/runtime-context");
    evidence(
      "generated_principal",
      typeof initial.principal_id === "string" &&
        initial.principal_id.length > 0 &&
        initial.first_run_complete === false,
    );
    evidence(
      "minimal_app_path",
      await application.evaluate(
        (_electron, expected) => process.env.PATH === expected,
        platform.env.PATH,
      ),
    );
    observeChildren();
    // A packaged app offers updates only after its own signature matched the
    // sealed publisher. The copy's ad-hoc signature does not, so it must
    // report "unavailable" and never contact the feed.
    step = "copy-updates";
    const update = await page.evaluate(() =>
      window.animamaDesktop.updates.check(),
    );
    evidence("copy_updates_unavailable", update?.state === "unavailable");
    // Setup is three steps: Welcome (required name) → AI → Voice, then age confirmation.
    step = "setup-welcome";
    const continueButton = page.getByRole("button", {
      name: "Continue",
      exact: true,
    });
    evidence("empty_name_rejected", await continueButton.isDisabled());
    await page.getByLabel("Display name", { exact: true }).fill("   ");
    evidence("blank_name_rejected", await continueButton.isDisabled());
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Desktop smoke");
    evidence("name_allows_setup", await continueButton.isEnabled());
    await continueButton.click();
    step = "setup-ai-provider";
    await page
      .getByRole("heading", { name: "Choose your AI" })
      .waitFor({ timeout: 60_000 });
    // Set before submission: even a failed save response may have persisted it.
    providerMayBeSaved = true;
    // The OpenAI provider tab's panel carries the same label as its key field.
    await page
      .getByLabel("OpenAI", { exact: true })
      .and(page.locator("input"))
      .fill(provider);
    // A key save applies in place: the same window and FastAPI process remain.
    const backendBeforeSave = fastapiPid();
    await page.evaluate(() => {
      window.__animamaSmokeWindow = true;
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // The panel announces success only after main answers; failure copy never
    // contains "saved." (a two-failure fallback would replace this window).
    await page
      .getByRole("status")
      .filter({ hasText: /\bsaved\./iu })
      .waitFor({ timeout: 60_000 });
    evidence(
      "provider_applied_without_restart",
      (await page.evaluate(() => window.__animamaSmokeWindow === true)) &&
        backendBeforeSave !== undefined &&
        fastapiPid() === backendBeforeSave,
    );
    const providerStatuses = await page.evaluate(() =>
      window.animamaDesktop.credentials.list(),
    );
    evidence(
      "provider_status_only",
      providerStatuses.some(
        (entry) => entry.provider === "openai" && entry.configured,
      ) && !JSON.stringify(providerStatuses).includes(provider),
    );
    await continueButton.click();
    step = "setup-voice";
    await page
      .getByRole("heading", { name: "Set up voice" })
      .waitFor({ timeout: 60_000 });
    const assetsBeforeFinish = await request(page, "/v1/model-assets");
    evidence(
      "setup_steps",
      assetsBeforeFinish.assets.every(
        (entry) => entry.status === "not_installed",
      ),
    );
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname !== "/" && url.pathname !== "/setup",
      { timeout: 60_000 },
    );
    step = "setup-age-confirmation";
    await page.getByRole("dialog", { name: "Before you start" }).waitFor();
    evidence(
      "adult_confirmation_required",
      (await request(page, "/v1/runtime-context")).first_run_complete === false,
    );
    await page
      .getByRole("button", { name: "I am 18 or older and agree", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Before you start" })
      .waitFor({ state: "hidden" });
    const context = await request(page, "/v1/runtime-context");
    evidence(
      "required_private_name",
      context.first_run_complete === true &&
        context.principal_id === initial.principal_id &&
        context.display_name === "Desktop smoke",
    );
    const firstAnima = (await request(page, "/v1/animas"))[0];
    await page.waitForURL((url) => url.pathname === `/${firstAnima?.id}`, {
      timeout: 60_000,
    });
    evidence("first_anima_chat", firstAnima?.display_name === "Annie");
    const capabilities = await request(page, "/v1/runtime-capabilities");
    for (const [name, passed] of Object.entries(
      desktopCapabilityChecks(capabilities),
    ))
      evidence(name, passed);
    step = "gateway-rejection";
    for (const headers of [
      {},
      { Origin: "https://hostile.invalid", "Sec-Fetch-Site": "cross-site" },
      {
        "X-Animama-Principal-Id": initial.principal_id,
        "X-Animama-Internal-Token": "spoof",
      },
    ]) {
      const response = await fetch(`${origin}/v1/runtime-context`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      evidence("gateway_rejection", [401, 403, 404].includes(response.status));
      await response.body?.cancel();
    }
    const control = await page.evaluate(
      async () => (await fetch("/_desktop/health")).status,
    );
    evidence("private_control_not_proxied", control === 404);
    step = "starter-chat-and-typed-bytes";
    const animas = await request(page, "/v1/animas");
    const list = Array.isArray(animas) ? animas : animas.items;
    evidence(
      "two_starters",
      ["Annie", "Andrew"].every((name) =>
        list?.some((entry) => entry.display_name === name),
      ),
    );
    const chatIds = [];
    for (const name of ["Annie", "Andrew"]) {
      const anima = list.find((entry) => entry.display_name === name);
      await page.goto(`${origin}/${anima.id}`);
      const chat = await request(page, "/v1/chats", {
        method: "POST",
        body: JSON.stringify({
          anima_id: anima.id,
          title: "Desktop release smoke",
        }),
      });
      chatIds.push(chat.id);
      // Use the same prepared runtime and public gateway as chat UI. Never bypass
      // ownership or inject an internal principal/control token in this harness.
      const result = await page.evaluate(
        async ({ animaId, chatId }) => {
          const runtimeResponse = await fetch(`/v1/animas/${animaId}/runtime`);
          const runtime = await runtimeResponse.json();
          if (
            !runtimeResponse.ok ||
            !runtime.effective_revision ||
            runtime.content_descriptor?.diagnostics?.length
          )
            return { completed: false };
          // Fetch at least one exact prepared member even if GPU/avatar startup is
          // slow on CI; successful rendering remains a separate manual gate.
          const member = runtime.content_descriptor.members
            ?.filter(
              (file) =>
                Number.isSafeInteger(file.size_bytes) &&
                file.size_bytes > 0 &&
                file.size_bytes <= 16 * 1024 * 1024,
            )
            .sort((a, b) => a.size_bytes - b.size_bytes)[0];
          if (
            !member ||
            new URL(member.url, location.origin).origin !== location.origin
          )
            return { completed: false };
          const bytes = await fetch(member.url, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!bytes.ok) return { completed: false };
          const byteReader = bytes.body.getReader();
          const parts = [];
          let length = 0;
          for (;;) {
            const { done, value } = await byteReader.read();
            if (done) break;
            length += value.length;
            if (length > member.size_bytes) {
              await byteReader.cancel();
              return { completed: false };
            }
            parts.push(value);
          }
          if (length !== member.size_bytes) return { completed: false };
          const delivered = await new Blob(parts).arrayBuffer();
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", delivered)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          if (digest !== member.sha256) return { completed: false };
          const response = await fetch(`/v1/animas/${animaId}/chat:sse`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Animama-CSRF": "1",
            },
            body: JSON.stringify({
              chat_id: chatId,
              message: "Say hello in one short sentence.",
              runtime_revision: runtime.effective_revision,
            }),
            signal: AbortSignal.timeout(120_000),
          });
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let body = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            body += decoder.decode(value, { stream: true });
            if (body.length > 1024 * 1024) {
              await reader.cancel();
              return { completed: false };
            }
          }
          return {
            completed:
              response.ok &&
              !/event:\s*error/u.test(body) &&
              /event:\s*run\.completed/u.test(body),
          };
        },
        { animaId: anima.id, chatId: chat.id },
      );
      evidence(`chat_${name.toLowerCase()}`, result.completed);
      const messages = await request(page, `/v1/chats/${chat.id}/messages`);
      evidence(
        `persisted_assistant_${name.toLowerCase()}`,
        messages.messages.some(
          (message) => message.role === "assistant" && message.content?.trim(),
        ),
      );
    }
    step = "private-file-upload";
    const file = await page.evaluate(async () => {
      const text = "Animama signed desktop smoke fixture.\n";
      const init = await fetch("/v1/files/uploads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Animama-CSRF": "1",
        },
        body: JSON.stringify({
          filename: "desktop-smoke.txt",
          content_type: "text/plain",
          size_bytes: new TextEncoder().encode(text).length,
        }),
      });
      if (!init.ok) return null;
      const upload = await init.json();
      if (
        new URL(upload.upload_url, location.origin).origin !==
          location.origin ||
        upload.method !== "PUT"
      )
        return null;
      const sent = await fetch(upload.upload_url, {
        method: "PUT",
        headers: { ...upload.headers, "X-Animama-CSRF": "1" },
        body: text,
      });
      if (!sent.ok) return null;
      const finalized = await fetch(`/v1/files/${upload.file_id}:finalize`, {
        method: "POST",
        headers: { "X-Animama-CSRF": "1" },
      });
      if (!finalized.ok) return null;
      return finalized.json();
    });
    evidence(
      "private_file_creation",
      file?.status === "uploaded" && file?.stored_size_bytes > 0,
    );
    // Reading the file runs the packaged runtime's own `parse-upload` child.
    step = "private-file-processing";
    await request(page, `/v1/files/${file.file_id}:process`, {
      method: "POST",
      body: "{}",
    });
    const processingDeadline = Date.now() + 60_000;
    let processed = await request(page, `/v1/files/${file.file_id}`);
    while (
      ["uploaded", "processing"].includes(processed.status) &&
      Date.now() < processingDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      processed = await request(page, `/v1/files/${file.file_id}`);
    }
    // A failed embedding call leaves the file usable through keyword search.
    const searchable = ["ready", "ready_keyword_only"];
    evidence(
      "private_file_processing",
      searchable.includes(processed?.status) && processed.chunk_count > 0,
    );
    step = "restart-persistence";
    const stableOrigin = origin;
    await close();
    application = await launch();
    page = await readyPage();
    const restarted = await request(page, "/v1/runtime-context");
    evidence(
      "restart_identity_and_setup",
      restarted.principal_id === initial.principal_id &&
        restarted.first_run_complete &&
        origin === stableOrigin,
    );
    for (const id of chatIds) {
      const chat = await request(page, `/v1/chats/${id}`);
      evidence("chat_persistence", chat.id === id);
    }
    const persistedFile = await request(page, `/v1/files/${file.file_id}`);
    evidence(
      "private_file_persistence",
      persistedFile.sha256 === file.sha256 &&
        searchable.includes(persistedFile.status),
    );
    evidence(
      "provider_persistence",
      await page.evaluate(async () =>
        (await window.animamaDesktop.credentials.list()).some(
          (entry) => entry.provider === "openai" && entry.configured,
        ),
      ),
    );
    step = "temporary-provider-cleanup";
    await cleanupProvider();
    await readyPage();
    observeChildren();
    await close();
    application = await launch();
    page = await readyPage();
    evidence(
      "temporary_provider_removal_persists",
      await page.evaluate(async () =>
        (await window.animamaDesktop.credentials.list()).some(
          (entry) => entry.provider === "openai" && !entry.configured,
        ),
      ),
    );
    observeChildren();
    await close();
    step = "sanitized-evidence";
    evidence(
      "typed_bytes_same_origin",
      trace.some(
        (entry) => entry.family === "typed-byte" && entry.status === 200,
      ) && traceFailures.size === 0,
    );
    let scanned = 0;
    const logs = path.join(journey.userData, "runtime/logs");
    for (const name of readdirSync(logs, { recursive: true })) {
      const file = path.join(logs, String(name));
      if (!lstatSync(file).isFile()) continue;
      scanned++;
      evidence(
        "provider_secret_absent_from_logs",
        !readFileSync(file, "utf8").includes(provider),
      );
    }
    evidence("logs_present", scanned > 0);
    report.passed = true;
  } catch (error) {
    // Playwright/OS exceptions may contain key input, URLs and machine paths,
    // so they reach neither the report nor the console unless asked for here.
    report.failed_step = step;
    // Playwright's call log repeats typed input, so the key is masked first.
    if (process.env.ANIMAMA_SMOKE_DEBUG === "1")
      console.error(
        String(error?.stack ?? error).replaceAll(provider, "[provider key]"),
      );
  } finally {
    // The key lives only in the copy's throwaway vault, which is deleted
    // below; a failed removal through the app still fails the smoke.
    await cleanupProvider().catch(() => {
      report.passed = false;
      // Keep the step that failed first; cleanup failure is reported separately.
      report.failed_step ??= "temporary-provider-cleanup";
    });
    if (application)
      await close().catch(() => {
        report.passed = false;
        report.failed_step ??= "owned-child-shutdown";
      });
    // The copy and its throwaway profile never outlive the run.
    if (work)
      try {
        rmSync(work, { recursive: true, force: true });
        copyRemoved = true;
      } catch {
        report.passed = false;
        report.failed_step ??= "journey-copy-removal";
        report.cleanup_required = addCleanup(
          report.cleanup_required,
          "Delete the smoke's journey copy folder (an `animama-smoke` or `am-smoke` folder in the temporary or local app data folder); it holds the copy and its throwaway profile, including the temporary OpenAI key.",
        );
      }
    const cleanupFailure = platform.cleanup?.() ?? null;
    if (cleanupFailure) {
      report.passed = false;
      report.failed_step ??= cleanupFailure;
    }
    writeJson(path.join(output, "smoke-report.json"), report);
    writeJson(path.join(output, "network-report.json"), {
      schema: "animama-smoke-network/1",
      scope: "renderer-requests-and-responses-after-harness-attachment",
      events: trace,
      violations: traceFailures.size,
    });
  }
  if (!report.passed)
    throw new Error(
      `Native artifact smoke did not pass (${report.failed_step}); inspect the sanitized smoke report. The installed app is preserved${copyRemoved ? "; the journey copy and its profile were deleted" : ""}.${report.cleanup_required ? ` ${report.cleanup_required}` : ""}`,
    );
  console.log(
    `Signed artifact smoke passed (${report.setup}); the temporary OpenAI key was removed. Manual native/update acceptance is still required. The installed app is preserved; the journey copy and its profile were deleted.`,
  );
}
