/** Actual emitted creator data survives the selected app, upgrade and rollback. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const metadata = {
    mutedProceduralLayers: [
        "breathing",
        "sway",
        "bounce",
        "headNod",
        "headSideTilt",
        "cursorLookAt",
        "emotionPosture",
    ],
    generator: { tool: "animama-animation", source: "wave.motion.json" },
    futureMetadata: { enabled: false, tags: ["reviewed"] },
};
const normal = {
    schema: "animaPoseClip/1.0",
    id: "normal-compatibility",
    name: "NormalCompatibility",
    role: "motion",
    duration: 1,
    ...metadata,
    poses: {
        a: { expressions: { happy: 0 } },
        b: { expressions: { happy: 0.75 } },
    },
    poseKeyframes: [
        { time: 0, pose: "a" },
        { time: 1, pose: "b" },
    ],
};
const effectOnly = {
    ...normal,
    id: "effect-compatibility",
    name: "EffectCompatibility",
    poses: {},
    poseKeyframes: [],
    events: [
        {
            id: "hearts",
            time: 0.4,
            kind: "particle_vfx",
            effectId: "hearts",
            duration: 0.2,
        },
    ],
};
const project = (sequence) => ({
    schema: "animamaActionProject/1.0",
    intent: "gesture",
    name: sequence.name,
    description: "Controlled exact-artifact compatibility clip",
    aiDescription: "Use this controlled clip for compatibility checks.",
    semanticKey: sequence.id.replaceAll("-", "_"),
    suggestedEmotion: "",
    suggestedIntensity: 1,
    notes: "",
    sequence,
    dependencies: sequence.events
        ? [
              {
                  alias: "hearts",
                  content_type: "particle_effect",
                  source: {
                      type: "builtin",
                      content_id: "builtin:particle-effect:hearts",
                      version: 1,
                  },
              },
          ]
        : [],
});

function assertMetadata(sequence) {
    assert.equal(sequence.schema, "animaPoseClip/1.0");
    for (const [key, value] of Object.entries(metadata))
        assert.deepEqual(
            sequence[key],
            value,
            `Retain ${key} across emitted app selections`,
        );
}

async function exportProject(page) {
    await page.getByRole("button", { name: "View JSON", exact: true }).click();
    await page.getByRole("combobox", { name: "JSON format" }).click();
    await page
        .getByRole("option", { name: "Typed project JSON", exact: true })
        .click();
    await page.waitForFunction(() => {
        const preview = document.querySelector(
            'textarea[aria-label="Creator JSON preview"]',
        );
        try {
            return (
                JSON.parse(preview?.value ?? "").schema ===
                "animamaActionProject/1.0"
            );
        } catch {
            return false;
        }
    });
    const preview = JSON.parse(
        await page.getByLabel("Creator JSON preview").inputValue(),
    );
    const pending = page.waitForEvent("download");
    pending.catch(() => {});
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await pending,
        stream = await download.createReadStream(),
        chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks),
        exported = JSON.parse(bytes);
    assert.deepEqual(
        exported,
        preview,
        "Downloaded bytes match the creator's project export",
    );
    assertMetadata(exported.sequence);
    await page.keyboard.press("Escape");
    return { project: exported, sha256: sha(bytes), bytes: bytes.length };
}

/** Fixture HTTP state, not a renderer hook, keeps each clip's real uploaded bytes. */
export async function exerciseClipCompatibility(
    browser,
    server,
    applications,
    selectionKind,
) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
    });
    const owner = "artifact-clip-owner",
        admission = await server.admit(owner, true);
    server.initializeClipFixtures(admission);
    await context.addCookies([
        {
            name: "fixture_session",
            value: admission.cookie,
            url: server.origin,
        },
    ]);
    const ids = new Map(),
        receipts = [];
    const errors = [],
        external = [],
        consoleErrors = [];
    context.on("request", (request) => {
        const url = new URL(request.url());
        if (
            !["blob:", "data:"].includes(url.protocol) &&
            url.origin !== server.origin
        )
            external.push(url.href);
    });
    const selections =
        applications.length === 1
            ? applications
            : [applications[0], applications.at(-1), applications[0]];
    const labels =
        applications.length === 1
            ? ["single"]
            : ["first", "upgraded", "rollback"];
    let page;
    try {
        for (const [index, app] of selections.entries()) {
            server.select(app);
            for (const [kind, sequence] of [
                ["normal", normal],
                ["effect-only", effectOnly],
            ]) {
                page = await context.newPage();
                page.setDefaultTimeout(15000);
                page.on("pageerror", (error) => errors.push(error.message));
                page.on("console", (message) => {
                    if (message.type() === "error")
                        consoleErrors.push(message.text());
                });
                page.on("dialog", (dialog) => dialog.accept());
                await page.goto(
                    server.origin +
                        (ids.has(kind)
                            ? `/gestures/${ids.get(kind)}/edit`
                            : "/gestures/new"),
                );
                await page
                    .getByRole("tab", { name: "Clip", exact: true })
                    .click();
                await page
                    .getByRole("button", { name: "Import", exact: true })
                    .waitFor();
                if (!ids.has(kind)) {
                    await page
                        .getByRole("button", { name: "Import", exact: true })
                        .click();
                    await page
                        .getByLabel("Creator JSON import")
                        .fill(JSON.stringify(project(sequence)));
                    await page
                        .getByRole("button", {
                            name: "Import pasted JSON",
                            exact: true,
                        })
                        .click();
                    await page
                        .getByText(
                            "Typed project imported with exact dependency pins.",
                            {
                                exact: true,
                            },
                        )
                        .waitFor();
                    await page.keyboard.press("Escape");
                } else {
                    const reopened = await exportProject(page);
                    assertMetadata(reopened.project.sequence);
                }
                const name =
                    (kind === "normal" ? "Normal" : "Effect") + labels[index];
                await page
                    .getByLabel("gesture name", { exact: true })
                    .fill(name);
                await page
                    .getByLabel("AI selection description", { exact: true })
                    .fill("Use this controlled clip for compatibility checks.");
                const pending = page.waitForResponse(
                    (response) =>
                        response.request().method() === "PUT" &&
                        new URL(response.url()).pathname.startsWith(
                            "/v1/gestures/",
                        ),
                );
                pending.catch(() => {});
                await page
                    .getByRole("button", { name: "Save content", exact: true })
                    .click();
                const response = await pending;
                assert.equal(response.status(), 200);
                const saved = await response.json();
                ids.set(kind, saved.item_id);
                await page.waitForURL(
                    (url) => url.pathname === `/gestures/${saved.item_id}/edit`,
                );
                const recorded = server.clipRecords.findLast(
                    (record) =>
                        record.action === "save" &&
                        record.item_id === saved.item_id &&
                        record.revision === saved.revision_sha256,
                );
                assert.ok(
                    recorded,
                    "Capture actual server-side multipart sequence bytes",
                );
                assertMetadata(recorded.sequence);
                const exported = await exportProject(page);
                assertMetadata(exported.project.sequence);
                await page.reload();
                await page
                    .getByLabel("gesture name", { exact: true })
                    .waitFor();
                const reopened = await exportProject(page);
                assertMetadata(reopened.project.sequence);
                assert.ok(
                    server.clipRecords.some(
                        (record) =>
                            record.action === "read" &&
                            record.item_id === saved.item_id &&
                            record.revision === saved.revision_sha256 &&
                            record.status === 200,
                    ),
                    "Reopen actual private persisted HTTP bytes",
                );
                if (kind === "effect-only") {
                    assert.deepEqual(
                        reopened.project.sequence.poseKeyframes,
                        [],
                    );
                    assert.equal(
                        reopened.project.sequence.events[0].kind,
                        "particle_vfx",
                    );
                    assert.equal(reopened.project.dependencies.length, 1);
                }
                receipts.push({
                    selection: labels[index],
                    source_commit: app.manifest.source_commit,
                    kind,
                    item_id: saved.item_id,
                    uploaded_sha256: recorded.sequence_sha256,
                    uploaded_bytes: recorded.bytes,
                    export_sha256: exported.sha256,
                    reopen_export_sha256: reopened.sha256,
                    metadata_preserved: true,
                });
                await page.close();
            }
        }
        // Delete only the two exact items this disposable owner journey created.
        const csrf = (
            await (
                await context.request.get(
                    server.origin + "/v1/hosted/runtime-context",
                )
            ).json()
        ).csrf_token;
        for (const id of ids.values()) {
            const revision = admission.state.items.get(id).revision_sha256;
            const response = await context.request.delete(
                server.origin +
                    "/v1/content/items/" +
                    id +
                    "?expected_revision=" +
                    revision,
                { headers: { origin: server.origin, "x-animama-csrf": csrf } },
            );
            assert.equal(response.status(), 200);
            assert.equal(admission.state.items.has(id), false);
        }
        assert.equal(
            [...admission.state.items.values()].filter(
                (item) => item.source === "local",
            ).length,
            0,
        );
        page = await context.newPage();
        await page.goto(server.origin);
        await page
            .getByRole("button")
            .filter({ hasText: `${owner} account` })
            .click();
        await page
            .getByRole("menuitem", { name: "Sign out", exact: true })
            .click();
        await page
            .getByRole("heading", { name: "Sign in to Animama", exact: true })
            .waitFor();
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        return {
            selection_kind: selectionKind,
            receipts,
            cleanup: [...ids.values()],
            remaining_owned_clips: 0,
            signed_out: true,
            first_point_playback_limit:
                "The pre-sync app preserves layer-mute metadata as opaque data; it does not implement newer procedural layer muting.",
            future_id_semantics_verified: false,
        };
    } catch (error) {
        const body =
            page && !page.isClosed()
                ? await page.locator("body").innerText()
                : "";
        writeFileSync(
            "clip-compatibility-failure.json",
            JSON.stringify(
                {
                    error: error.message,
                    body,
                    receipts,
                    records: server.clipRecords,
                    errors,
                    consoleErrors,
                },
                null,
                2,
            ) + "\n",
        );
        if (page && !page.isClosed())
            await page.screenshot({
                path: "clip-compatibility-failure.png",
                fullPage: true,
            });
        throw error;
    } finally {
        await context.close();
    }
}
