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

export function assertClip(sequence, expectedSchema, kind) {
    assert.ok(["normal", "effect-only"].includes(kind));
    assert.ok(
        ["animaPoseClip/1.0", "animaPoseClip/2.0"].includes(expectedSchema),
    );
    assert.equal(
        sequence.schema,
        expectedSchema,
        "The selected source must emit its declared clip format",
    );
    for (const [key, value] of Object.entries(metadata))
        assert.deepEqual(
            sequence[key],
            value,
            `Retain ${key} across emitted app selections`,
        );
    assert.equal(sequence.role, "motion");
    assert.equal(sequence.duration, 1);
    const effect = kind === "effect-only";
    if (expectedSchema === "animaPoseClip/1.0") {
        assert.deepEqual(
            sequence.poseKeyframes.map(({ time }) => time),
            effect ? [] : [0, 1],
        );
        if (!effect)
            assert.deepEqual(
                sequence.poseKeyframes.map(
                    ({ pose }) => sequence.poses[pose].expressions.happy,
                ),
                [0, 0.75],
            );
    } else {
        assert.deepEqual(
            sequence.beats.map(({ time }) => time),
            effect ? [] : [0, 1],
        );
        assert.equal(Object.hasOwn(sequence, "poseKeyframes"), false);
        assert.equal(Object.hasOwn(sequence, "poses"), false);
        if (effect) {
            for (const track of [
                "joints",
                "rotations",
                "hipsPosition",
                "hands",
                "expressions",
            ])
                assert.deepEqual(
                    Object.keys(sequence[track] ?? {}),
                    [],
                    "An effect-only clip retains no motion tracks",
                );
        } else {
            const keys = sequence.expressions.happy;
            assert.deepEqual(
                keys.map(({ v }) => v),
                [0, 0.75],
            );
            assert.deepEqual(
                keys.map(
                    ({ beat }) =>
                        sequence.beats.find((row) => row.id === beat).time,
                ),
                [0, 1],
            );
            assert.ok(keys.every(({ dt = 0 }) => dt === 0));
        }
    }
    if (effect) assert.deepEqual(sequence.events, effectOnly.events);
}

async function exportProject(page, expectedSchema, kind) {
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
    assertClip(exported.sequence, expectedSchema, kind);
    await page.keyboard.press("Escape");
    return { project: exported, sha256: sha(bytes), bytes: bytes.length };
}

/** Fixture HTTP state, not a renderer hook, keeps each clip's real uploaded bytes. */
export async function exerciseClipCompatibility(
    browser,
    server,
    applications,
    selectionKind,
    mode = "v2-edited-data",
) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
    });
    assert.ok(["v2-edited-data", "legacy-format-boundary"].includes(mode));
    const legacy = mode === "legacy-format-boundary";
    const owner = legacy ? "artifact-legacy-clip-owner" : "artifact-clip-owner",
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
        untouched = new Map(),
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
            const expectedSchema =
                legacy && index !== 1
                    ? "animaPoseClip/1.0"
                    : "animaPoseClip/2.0";
            const definitions = [
                ["normal", normal],
                ["effect-only", effectOnly],
            ];
            if (legacy)
                definitions.push(
                    ["untouched-normal", normal],
                    ["untouched-effect-only", effectOnly],
                );
            for (const [key, sequence] of definitions) {
                const isUntouched = key.startsWith("untouched-");
                const kind = key.replace(/^untouched-/, "");
                page = await context.newPage();
                page.setDefaultTimeout(15000);
                page.on("pageerror", (error) => errors.push(error.message));
                page.on("console", (message) => {
                    if (message.type() === "error")
                        consoleErrors.push(message.text());
                });
                page.on("dialog", (dialog) => dialog.accept());
                const readStart = server.clipRecords.length;
                await page.goto(
                    server.origin +
                        (ids.has(key)
                            ? `/gestures/${ids.get(key)}/edit`
                            : "/gestures/new"),
                );
                await page
                    .getByRole("tab", { name: "Clip", exact: true })
                    .click();
                await page
                    .getByRole("button", { name: "Import", exact: true })
                    .waitFor();
                if (legacy && index === 2 && !isUntouched) {
                    const item = admission.state.items.get(ids.get(key));
                    const revision = item.revision_sha256;
                    await page
                        .getByRole("button", { name: "View JSON", exact: true })
                        .click();
                    await page
                        .getByRole("combobox", { name: "JSON format" })
                        .click();
                    await page
                        .getByRole("option", {
                            name: "Typed project JSON",
                            exact: true,
                        })
                        .click();
                    await page
                        .getByText(
                            "This implementation does not have Anima Pose Clip JSON.",
                            { exact: true },
                        )
                        .waitFor();
                    assert.equal(
                        await page
                            .getByLabel("Creator JSON preview")
                            .inputValue(),
                        "",
                    );
                    assert.equal(
                        await page
                            .getByRole("button", {
                                name: "Download",
                                exact: true,
                            })
                            .isDisabled(),
                        true,
                    );
                    assert.equal(
                        admission.state.items.get(ids.get(key)).revision_sha256,
                        revision,
                    );
                    assert.equal(
                        JSON.parse(
                            admission.state.files.get(item.files[0].file_ref)
                                .bytes,
                        ).schema,
                        "animaPoseClip/2.0",
                    );
                    assert.ok(
                        server.clipRecords
                            .slice(readStart)
                            .some(
                                (record) =>
                                    record.action === "read" &&
                                    record.item_id === ids.get(key) &&
                                    record.revision === revision &&
                                    record.status === 200 &&
                                    record.sequence_sha256 === revision,
                            ),
                        "C actually received the persisted 2.0 bytes before refusing export",
                    );
                    receipts.push({
                        selection: "legacy-edited-data-refusal",
                        source_commit: app.manifest.source_commit,
                        kind,
                        item_id: ids.get(key),
                        persisted_schema: "animaPoseClip/2.0",
                        compatible_edited_data_rollback: false,
                        unsupported_export_observed: true,
                        unchanged_revision: revision,
                    });
                    await page.close();
                    continue;
                }
                if (legacy && isUntouched && index > 0) {
                    const before = untouched.get(key);
                    const reopened = await exportProject(
                        page,
                        expectedSchema,
                        kind,
                    );
                    await page.reload();
                    await page
                        .getByLabel("gesture name", { exact: true })
                        .waitFor();
                    const reloaded = await exportProject(
                        page,
                        expectedSchema,
                        kind,
                    );
                    assert.equal(
                        admission.state.items.get(ids.get(key)).revision_sha256,
                        before.revision,
                    );
                    assert.equal(
                        server.clipRecords.filter(
                            (record) =>
                                record.action === "save" &&
                                record.item_id === ids.get(key),
                        ).length,
                        1,
                    );
                    const payload = admission.state.files.get(before.file_ref);
                    assert.equal(sha(payload.bytes), before.sha256);
                    assert.equal(payload.bytes.length, before.bytes);
                    assert.equal(
                        JSON.parse(payload.bytes).schema,
                        "animaPoseClip/1.0",
                    );
                    assert.ok(
                        server.clipRecords.some(
                            (record) =>
                                record.action === "read" &&
                                record.item_id === ids.get(key) &&
                                record.revision === before.revision &&
                                record.status === 200,
                        ),
                    );
                    receipts.push({
                        selection:
                            index === 1
                                ? "legacy-read-only-forward"
                                : "legacy-untouched-rollback",
                        source_commit: app.manifest.source_commit,
                        kind,
                        item_id: ids.get(key),
                        persisted_schema: "animaPoseClip/1.0",
                        exported_schema: expectedSchema,
                        uploaded_sha256: before.sha256,
                        uploaded_bytes: before.bytes,
                        reopen_export_sha256: reopened.sha256,
                        reload_export_sha256: reloaded.sha256,
                        metadata_preserved: true,
                        persisted_bytes_unchanged: true,
                    });
                    await page.close();
                    continue;
                }
                if (!ids.has(key)) {
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
                    const reopened = await exportProject(
                        page,
                        expectedSchema,
                        kind,
                    );
                    assertClip(reopened.project.sequence, expectedSchema, kind);
                }
                const name =
                    (isUntouched ? "LegacyUntouched" : "") +
                    (kind === "normal" ? "Normal" : "Effect") +
                    labels[index];
                await page
                    .getByLabel("gesture name", { exact: true })
                    .fill(name);
                await page
                    .getByLabel("AI selection description", { exact: true })
                    .fill("Use this controlled clip for compatibility checks.");
                const saveStart = server.clipRecords.length;
                const saveDeadline = Date.now() + 15000;
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
                assert.ok(
                    Date.now() < saveDeadline,
                    "Save exceeded its 15-second deadline",
                );
                // Bind the browser's response status to the exact completed
                // HTTP reply, without relying on retained DevTools body buffers.
                const saves = server.clipRecords
                    .slice(saveStart)
                    .filter(
                        (record) =>
                            record.action === "save" && record.owner === owner,
                    );
                assert.equal(
                    saves.length,
                    1,
                    "One completed HTTP save emits one owned result",
                );
                assert.equal(
                    saves[0].request_path,
                    new URL(response.url()).pathname,
                );
                assert.equal(saves[0].response_finished, true);
                const saved = saves[0].response_body;
                assert.equal(saved.item_id, saves[0].item_id);
                assert.equal(saved.revision_sha256, saves[0].sequence_sha256);
                ids.set(key, saved.item_id);
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
                assertClip(recorded.sequence, expectedSchema, kind);
                const exported = await exportProject(
                    page,
                    expectedSchema,
                    kind,
                );
                assertClip(exported.project.sequence, expectedSchema, kind);
                await page.reload();
                await page
                    .getByLabel("gesture name", { exact: true })
                    .waitFor();
                const reopened = await exportProject(
                    page,
                    expectedSchema,
                    kind,
                );
                assertClip(reopened.project.sequence, expectedSchema, kind);
                assert.ok(
                    server.clipRecords.some(
                        (record) =>
                            record.action === "read" &&
                            record.item_id === saved.item_id &&
                            record.revision === saved.revision_sha256 &&
                            record.status === 200 &&
                            record.sequence_sha256 ===
                                recorded.sequence_sha256 &&
                            record.bytes === recorded.bytes,
                    ),
                    "Reopen actual private persisted HTTP bytes",
                );
                if (legacy && isUntouched && index === 0) {
                    const item = admission.state.items.get(saved.item_id);
                    untouched.set(key, {
                        revision: saved.revision_sha256,
                        file_ref: item.files[0].file_ref,
                        sha256: recorded.sequence_sha256,
                        bytes: recorded.bytes,
                    });
                }
                if (kind === "effect-only") {
                    assert.equal(
                        reopened.project.sequence.events[0].kind,
                        "particle_vfx",
                    );
                    assert.equal(reopened.project.dependencies.length, 1);
                }
                receipts.push({
                    selection: isUntouched
                        ? "legacy-untouched-create"
                        : labels[index],
                    clip_schema: expectedSchema,
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
        assert.equal(receipts.length, legacy ? 12 : selections.length * 2);
        if (legacy) {
            assert.equal(
                receipts.filter(
                    (row) =>
                        row.selection === "legacy-untouched-rollback" &&
                        row.persisted_bytes_unchanged,
                ).length,
                2,
            );
            assert.equal(
                receipts.filter(
                    (row) =>
                        row.selection === "legacy-edited-data-refusal" &&
                        row.unsupported_export_observed,
                ).length,
                2,
            );
        }
        // Delete only the exact items created by this disposable owner journey.
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
            mode,
            minimum_edited_data_rollback_format: legacy
                ? null
                : "animaPoseClip/2.0",
            exact_edited_data_rollback: !legacy && applications.length === 2,
            legacy_forward_conversion: legacy,
            legacy_untouched_data_rollback: legacy,
            legacy_edited_data_rollback_supported: legacy ? false : null,
            format_generations: applications.map((app, index) => ({
                source_commit: app.manifest.source_commit,
                emitted_schema:
                    legacy && index === 0
                        ? "animaPoseClip/1.0"
                        : "animaPoseClip/2.0",
            })),
            receipts,
            cleanup: [...ids.values()],
            remaining_owned_clips: 0,
            signed_out: true,
            first_point_playback_limit: legacy
                ? "Legacy C preserves layer-mute metadata as opaque data; it does not implement newer procedural layer muting."
                : "This fixture checks clip data semantics and emitted workers; it does not establish physical avatar/audio fidelity.",
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
