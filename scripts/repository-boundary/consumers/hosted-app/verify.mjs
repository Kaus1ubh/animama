/** Exercise emitted routes, bytes and real workers using an independent HTTP authority. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createApplicationServer } from "./server.mjs";
import { observeBrowser } from "./measurements.mjs";
import { exerciseClipCompatibility } from "./clips.mjs";

const load = (directory) => ({
    directory: path.resolve(directory),
    manifest: JSON.parse(
        readFileSync(path.join(directory, "app-manifest.json")),
    ),
});
const candidate = load(process.argv[2]);
const other = process.argv[3] ? load(process.argv[3]) : null;
const apps = other ? [other, candidate] : [candidate];
const clipMode = process.argv[5] ?? "v2-edited-data";
assert.ok(["v2-edited-data", "legacy-format-boundary"].includes(clipMode));
if (clipMode === "legacy-format-boundary") {
    assert.equal(process.argv[4], "verified-clean-legacy-format-pair");
    assert.equal(
        other?.manifest.source_commit,
        "c10218aeca1c4c68b37028bd0e5f56372fdfe98a",
    );
    assert.notEqual(
        other.manifest.source_commit,
        candidate.manifest.source_commit,
    );
}
if (process.argv[4] === "verified-clean-package-set-pair")
    assert.notEqual(
        other?.manifest.source_commit,
        candidate.manifest.source_commit,
    );
const clipSchemas = new Map(
    apps.map((app, index) => [
        app.directory,
        clipMode === "legacy-format-boundary" && index === 0
            ? "animaPoseClip/1.0"
            : "animaPoseClip/2.0",
    ]),
);
const initial = apps[0],
    upgraded = apps.at(-1);
const seed = JSON.parse(
    readFileSync(
        path.join(initial.directory, initial.manifest.catalog_seed.manifest),
    ),
);
const avatar = seed.inventory.starters[0].entries.find((name) =>
    name.endsWith(".vrm"),
);
assert.ok(avatar, "The real starter retains its VRM");
const prefix = (app) =>
    "/" +
    app.manifest.files
        .find((file) =>
            file.path.endsWith("/resource-manifests/browser-runtime.json"),
        )
        .path.split("resource-manifests/")[0];
// Consumer-only source revisions can legitimately emit identical runtime bytes.
// The server rejects any shared immutable URL whose verified payload differs.
const distinctResourceRevisions =
    Boolean(other) && prefix(initial) !== prefix(upgraded);
if (clipMode === "legacy-format-boundary")
    assert.equal(
        distinctResourceRevisions,
        true,
        "The separate legacy journey must exercise distinct resource generations",
    );
const server = await createApplicationServer(apps, {
    vrmFile: path.join(initial.directory, "catalog-seed/included", avatar),
    clipSchemaFor: (app) => clipSchemas.get(app.directory),
});
const browserArgs = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
];
const browser = await chromium.launch({ headless: true, args: browserArgs });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-CA",
    timezoneId: "America/Toronto",
});
const observation = await observeBrowser(context, browser);
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [],
    consoleErrors = [],
    externalRequests = [],
    network = [],
    measurements = [],
    routes = [];
context.on("request", (request) => {
    const url = new URL(request.url());
    if (
        !["blob:", "data:"].includes(url.protocol) &&
        url.origin !== server.origin
    )
        externalRequests.push(request.url());
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
        consoleErrors.push(message.text());
});
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.loadingFinished", (event) =>
    network.push({ bytes: event.encodedDataLength }),
);
const checkpoint = async (name) => {
    const result = {
        name,
        ...(await observation.snapshot(page, cdp)),
        completedEncodedPageNetworkBytes: network.reduce(
            (sum, event) => sum + event.bytes,
            0,
        ),
        completedStaticBodyBytesIncludingWorkers: server.calls
            .filter((call) => call.path.startsWith("/_animama/"))
            .reduce((sum, call) => sum + (call.completed_body_bytes ?? 0), 0),
    };
    measurements.push(result);
    console.log(
        JSON.stringify({
            phase: name,
            heapUsedBytes: result.heapUsedBytes,
            browserRssKiB: result.browserRssKiB,
            staticBodyBytes: result.completedStaticBodyBytesIncludingWorkers,
        }),
    );
    return result;
};
const admit = async (owner, roster = false) => {
    const admission = await server.admit(owner, roster);
    await context.addCookies([
        {
            name: "fixture_session",
            value: admission.cookie,
            url: server.origin,
            httpOnly: true,
            sameSite: "Lax",
        },
    ]);
    return admission;
};
const voice = async (owner) => {
    await page
        .getByRole("button")
        .filter({ hasText: `${owner} account` })
        .click();
    await page
        .getByRole("menuitem", { name: "App Settings", exact: true })
        .click();
    const dialog = page.getByRole("dialog", {
        name: "App Settings",
        exact: true,
    });
    await dialog.getByRole("button", { name: "Voice", exact: true }).click();
    await dialog
        .getByRole("switch", { name: "Enable Text-to-Speech", exact: true })
        .check();
    await dialog
        .getByRole("combobox", { name: "Text-to-Speech provider", exact: true })
        .click();
    await page.getByRole("option", { name: "PocketTTS", exact: true }).click();
    await dialog
        .getByRole("button", { name: "Close App Settings", exact: true })
        .click();
};
const chatPcm = async () => {
    const input = page.getByRole("textbox", {
        name: "What's on your mind?",
        exact: true,
    });
    await input.fill("Hello");
    await input.press("Enter");
    await page.waitForFunction(
        () =>
            window.artifactResources.worklets.some(
                (worklet) =>
                    worklet.nonzeroSamples > 0 &&
                    worklet.messages.includes("playback-started"),
            ),
        {},
        { timeout: 120000 },
    );
    assert.ok(
        await page.evaluate(() =>
            window.artifactResources.audio.some(
                (audio) => audio.state === "running",
            ),
        ),
        "Real AudioContext receives generated speech",
    );
};
const signOut = async (owner) => {
    await page
        .getByRole("button")
        .filter({ hasText: `${owner} account` })
        .click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await page
        .getByRole("heading", { name: "Sign in to Animama", exact: true })
        .waitFor();
    await page.waitForFunction(
        () =>
            window.artifactResources.workers.every(
                (worker) => worker.terminated,
            ) &&
            window.artifactResources.audio.every(
                (audio) => audio.state === "closed",
            ) &&
            window.artifactResources.created.every((url) =>
                window.artifactResources.revoked.includes(url),
            ),
    );
    assert.equal(
        (
            await context.request.get(
                server.origin + "/v1/content/runtime-fixture/avatar.vrm",
            )
        ).status(),
        401,
        "Ended session loses private bytes",
    );
};
try {
    await admit("artifact-owner");
    for (const temperature of ["cold", "warm"]) {
        const started = Date.now(),
            byteStart = network.reduce((sum, event) => sum + event.bytes, 0);
        await page.goto(server.origin);
        await page
            .getByRole("heading", { name: "Your Animas will appear here" })
            .waitFor();
        const measured = await checkpoint(`${temperature}-production-shell`);
        measured.readyWallMs = Date.now() - started;
        measured.navigationEncodedPageNetworkBytes =
            measured.completedEncodedPageNetworkBytes - byteStart;
    }
    assert.equal(
        server.calls.filter((call) =>
            /\.(onnx|npy|safetensors)$/.test(call.path),
        ).length,
        0,
        "Models stay lazy before voice action",
    );
    assert.equal(
        server.calls.filter((call) => /installation|bootstrap/.test(call.path))
            .length,
        0,
        "Hosted has no installation startup",
    );
    assert.equal(
        (await fetch(server.origin + "/src/main.hosted.tsx")).status,
        404,
    );
    assert.equal(
        (await fetch(server.origin + "/catalog-seed/included/" + avatar))
            .status,
        404,
        "Seed is not static content",
    );
    assert.equal(
        (await fetch(server.origin + "/v1/not-an-api")).headers.get(
            "content-type",
        ),
        "application/json",
    );
    const runtimePath = initial.manifest.files.find((file) =>
        file.path.endsWith("/resource-manifests/browser-runtime.json"),
    ).path;
    const runtime = JSON.parse(
        readFileSync(path.join(initial.directory, runtimePath)),
    );
    assert.equal(runtime.files.length, 21);
    assert.equal(
        runtime.files.reduce((sum, file) => sum + file.size, 0),
        280549335,
    );
    for (const expected of runtime.files) {
        const file = initial.manifest.files.find(
            (file) =>
                "/" + file.path === prefix(initial) + "onnx/" + expected.path,
        );
        assert.equal(file.sha256, expected.sha256);
        assert.equal(file.size, expected.size);
    }
    for (const file of initial.manifest.files) {
        const response = await fetch(server.origin + "/" + file.path, {
            method: "HEAD",
        });
        assert.equal(response.status, 200, file.path);
        assert.equal(response.headers.get("content-type"), file.mime_type);
        assert.equal(Number(response.headers.get("content-length")), file.size);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(
            response.headers.get("cache-control").includes("immutable"),
            file.cache === "immutable",
        );
        assert.equal(
            response.headers
                .get("content-security-policy")
                .includes("'unsafe-eval'"),
            file.path.endsWith("/tts/workers/inference-worker.js"),
            "Eval stays confined to the exact pinned sentencepiece worker",
        );
    }
    const wasm = initial.manifest.files.find((file) =>
        file.path.endsWith(".wasm"),
    );
    const response = await fetch(server.origin + "/" + wasm.path, {
        headers: { range: "bytes=0-63" },
    });
    assert.equal(response.status, 206);
    assert.equal(
        response.headers.get("content-range"),
        `bytes 0-63/${wasm.size}`,
    );
    assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        readFileSync(path.join(initial.directory, wasm.path)).subarray(0, 64),
    );
    const mismatch = await fetch(server.origin + "/" + wasm.path, {
        method: "HEAD",
        headers: { range: "bytes=0-63", "if-range": '"wrong-version"' },
    });
    assert.equal(mismatch.status, 200);
    assert.equal(Number(mismatch.headers.get("content-length")), wasm.size);
    assert.equal(
        (
            await fetch(server.origin + "/" + wasm.path, {
                headers: { "if-none-match": `"sha256-${wasm.sha256}"` },
            })
        ).status,
        304,
    );
    for (const [route, ready] of [
        [
            "/library",
            () =>
                page
                    .getByRole("heading", { name: "Library", exact: true })
                    .waitFor(),
        ],
        [
            "/create",
            () =>
                page
                    .getByRole("heading", { name: "Create", exact: true })
                    .waitFor(),
        ],
        [
            "/particle-effects/new",
            () =>
                page
                    .getByRole("button", { name: "Save", exact: true })
                    .first()
                    .waitFor(),
        ],
        [
            "/avatar-effects/new",
            () =>
                page
                    .getByRole("button", { name: "Save", exact: true })
                    .first()
                    .waitFor(),
        ],
        [
            "/scene-effects/new",
            () =>
                page
                    .getByRole("button", { name: "Save", exact: true })
                    .first()
                    .waitFor(),
        ],
        [
            "/a/library",
            () =>
                page
                    .getByRole("heading", { name: "Library", exact: true })
                    .waitFor(),
        ],
    ]) {
        await page.goto(server.origin + route);
        await ready();
        routes.push({ requested: route, final: new URL(page.url()).pathname });
        if (route === "/particle-effects/new")
            await page.screenshot({
                path: "whole-app-creator.png",
                fullPage: true,
            });
    }
    await page.screenshot({ path: "whole-app-library.png", fullPage: true });
    await checkpoint("retained-deep-links");
    await admit("artifact-owner", true);
    for (const temperature of ["cold", "warm"]) {
        const started = Date.now(),
            byteStart = network.reduce((sum, event) => sum + event.bytes, 0);
        await page.goto(server.origin + "/fixture-anima");
        await page.waitForFunction(
            () =>
                performance
                    .getEntriesByType("mark")
                    .some((mark) => mark.name.endsWith(":first-posed-frame")),
            {},
            { timeout: 60000 },
        );
        const measured = await checkpoint(`${temperature}-first-avatar`);
        measured.readyWallMs = Date.now() - started;
        measured.navigationEncodedPageNetworkBytes =
            measured.completedEncodedPageNetworkBytes - byteStart;
    }
    await page.screenshot({ path: "whole-app-avatar.png", fullPage: true });
    // Keep A's actual page open while B becomes the server's entry selection.
    // Its next runtime-created worker and model URLs must still resolve A's bytes.
    server.select(upgraded);
    const voiceStart = Date.now(),
        callStart = server.calls.length;
    await voice("artifact-owner");
    await page.waitForFunction(
        () =>
            window.artifactResources.workers.some(
                (worker) =>
                    worker.messages.includes("ready") ||
                    worker.messages.includes("error"),
            ),
        {},
        { timeout: 120000 },
    );
    assert.ok(
        await page.evaluate(() =>
            window.artifactResources.workers.some((worker) =>
                worker.messages.includes("ready"),
            ),
        ),
        "Pinned models initialize without a substitute engine",
    );
    (await checkpoint("cold-first-voice-ready")).readyWallMs =
        Date.now() - voiceStart;
    const pcmStart = Date.now();
    await chatPcm();
    (await checkpoint("cold-first-voice-playback")).firstPcmWallMs =
        Date.now() - pcmStart;
    assert.equal(
        server.calls.filter((call) =>
            call.path.startsWith(
                prefix(initial) + "onnx/models/pocket-tts/animas/",
            ),
        ).length,
        0,
        "Owner voice catalogs are private API bytes, not immutable application resources",
    );
    const workerCalls = server.calls
        .slice(callStart)
        .filter((call) =>
            call.path.endsWith("/tts/workers/inference-worker.js"),
        );
    assert.ok(
        workerCalls.some(
            (call) =>
                call.path.startsWith(prefix(initial)) && call.status === 200,
        ),
        "Open A tab creates A's worker after selection changes",
    );
    await signOut("artifact-owner");
    await checkpoint("sign-out-cleanup");
    const endedCookie = await context.cookies();
    await admit("artifact-owner");
    await page.goto(server.origin);
    await page
        .getByRole("heading", { name: "Your Animas will appear here" })
        .waitFor();
    assert.equal(await page.getByText("Hello", { exact: true }).count(), 0);
    const reauthenticatedCookie = await context.cookies();
    assert.notDeepEqual(
        reauthenticatedCookie.map((cookie) => cookie.value),
        endedCookie.map((cookie) => cookie.value),
        "Same owner receives a fresh admitted session",
    );
    await admit("second-owner", true);
    await page.goto(server.origin + "/fixture-anima");
    await page.waitForFunction(
        () =>
            performance
                .getEntriesByType("mark")
                .some((mark) => mark.name.endsWith(":first-posed-frame")),
        {},
        { timeout: 60000 },
    );
    assert.equal(
        await page.getByText("Hello", { exact: true }).count(),
        0,
        "The second owner cannot see the first owner's chat",
    );
    const warmVoiceStart = Date.now();
    await voice("second-owner");
    await page.waitForFunction(
        () =>
            window.artifactResources.workers.some((worker) =>
                worker.messages.includes("ready"),
            ),
        {},
        { timeout: 120000 },
    );
    (await checkpoint("warm-first-voice-ready")).readyWallMs =
        Date.now() - warmVoiceStart;
    const warmPcmStart = Date.now();
    await chatPcm();
    (await checkpoint("warm-first-voice-playback")).firstPcmWallMs =
        Date.now() - warmPcmStart;
    assert.ok(
        await page.evaluate(
            (expected) =>
                window.artifactResources.workers.some((worker) =>
                    worker.url.includes(expected),
                ),
            prefix(upgraded) + "tts/workers/inference-worker.js",
        ),
        "A fresh selected page uses B's actual worker URL",
    );
    await signOut("second-owner");
    await checkpoint("second-owner-cleanup");
    server.select(initial);
    await admit("rollback-owner");
    await page.goto(server.origin);
    await page
        .getByRole("heading", { name: "Your Animas will appear here" })
        .waitFor();
    assert.ok(
        await page.evaluate(
            (expected) =>
                [...document.scripts].some((script) =>
                    script.src.includes(expected),
                ),
            prefix(initial),
        ),
        "Rollback selects A's emitted entry and retained chunks",
    );
    const clipCompatibility = await exerciseClipCompatibility(
        browser,
        server,
        apps,
        process.argv[4] ?? "single-revision",
        clipMode,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
        externalRequests,
        [],
        "The isolated browser has no external provider, source or model dependency",
    );
    const report = {
        status: "PASS",
        kind: "actual-emitted-whole-application",
        source_commit: candidate.manifest.source_commit,
        app_version: candidate.manifest.app_version,
        files: candidate.manifest.files.length,
        baseline_speech_files: 21,
        baseline_speech_bytes: 280549335,
        source_modules_available_to_browser: false,
        installation_calls: 0,
        provider_calls: 0,
        clip_compatibility: clipCompatibility,
        physical_capture_or_heard_audio: false,
        browser: {
            version: observation.browserVersion,
            headless: true,
            args: browserArgs,
            viewport: { width: 1440, height: 900 },
        },
        measurement_protocol:
            "No forced GC; Runtime.getHeapUsage; 100ms page heap samples; 1s summed browser-process RSS; page CDP encoded bytes plus server static body bytes including workers. Warm cases reuse the browser HTTP cache.",
        selection: {
            kind: process.argv[4] ?? "single-revision",
            distinct_resource_revisions: distinctResourceRevisions,
            initial_source: initial.manifest.source_commit,
            selected_source: upgraded.manifest.source_commit,
            initial_prefix: prefix(initial),
            selected_prefix: prefix(upgraded),
            old_tab_late_worker: Boolean(other),
            rollback_entry: Boolean(other),
        },
        routes,
        measurements,
        http_calls: server.calls,
        authority_calls: server.apiCalls,
        external_requests: externalRequests,
        errors,
    };
    writeFileSync(
        "whole-app-receipt.json",
        JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
        JSON.stringify({
            status: report.status,
            files: report.files,
            measurements: measurements.map((measurement) => ({
                name: measurement.name,
                heapUsedBytes: measurement.heapUsedBytes,
                browserRssKiB: measurement.browserRssKiB,
            })),
        }),
    );
} catch (error) {
    writeFileSync(
        "whole-app-failure.json",
        JSON.stringify(
            {
                error: error.message,
                errors,
                consoleErrors,
                http_calls: server.calls,
                measurements,
                body: await page.locator("body").innerText(),
            },
            null,
            2,
        ) + "\n",
    );
    throw error;
} finally {
    observation.close();
    await context.close();
    await browser.close();
    await server.close();
}
