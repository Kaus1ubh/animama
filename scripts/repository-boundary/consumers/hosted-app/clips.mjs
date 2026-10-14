/** Actual emitted creator data survives the selected app, upgrade and rollback. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

// Each browser step's bound, generous for two-core CI runners; wall times are
// measured separately.
export const STEP_TIMEOUT_MS = 45000;

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
    schema: "animaPoseClip/2.0",
    id: "normal-compatibility",
    name: "NormalCompatibility",
    role: "motion",
    duration: 1,
    ...metadata,
    beats: [
        { id: "a", label: "A", time: 0 },
        { id: "b", label: "B", time: 1 },
    ],
    expressions: {
        happy: [
            { beat: "a", v: 0 },
            { beat: "b", v: 0.75 },
        ],
    },
};
const effectOnly = {
    ...normal,
    id: "effect-compatibility",
    name: "EffectCompatibility",
    beats: [],
    expressions: {},
    events: [
        {
            id: "heart-burst",
            time: 0.4,
            kind: "particle_vfx",
            effectId: "heart-burst",
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
                  alias: "heart-burst",
                  content_type: "particle_effect",
                  source: {
                      type: "builtin",
                      content_id: "builtin:particle-effect:heart-burst",
                      version: 1,
                  },
              },
          ]
        : [],
});

export function assertClip(sequence, expectedSchema, kind) {
    assert.ok(["normal", "effect-only"].includes(kind));
    assert.equal(expectedSchema, "animaPoseClip/2.0");
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

/**
 * Fixture HTTP state, not a renderer hook, keeps each clip's real uploaded bytes.
 * `endPhase(name)` records the wall time of each selection and clip kind.
 */
export async function exerciseClipCompatibility(
    browser,
    server,
    applications,
    selectionKind,
    endPhase = () => {},
) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
    });
    context.setDefaultTimeout(STEP_TIMEOUT_MS);
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
            const expectedSchema = "animaPoseClip/2.0";
            const definitions = [
                ["normal", normal],
                ["effect-only", effectOnly],
            ];
            for (const [kind, sequence] of definitions) {
                page = await context.newPage();
                page.on("pageerror", (error) => errors.push(error.message));
                page.on("console", (message) => {
                    if (message.type() === "error")
                        consoleErrors.push(message.text());
                });
                page.on("dialog", (dialog) => dialog.accept());
                const readStart = server.clipRecords.length;
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
                    const reopened = await exportProject(
                        page,
                        expectedSchema,
                        kind,
                    );
                    assertClip(reopened.project.sequence, expectedSchema, kind);
                }
                const name =
                    (kind === "normal" ? "Normal" : "Effect") + labels[index];
                await page
                    .getByLabel("gesture name", { exact: true })
                    .fill(name);
                await page
                    .getByLabel("AI selection description", { exact: true })
                    .fill("Use this controlled clip for compatibility checks.");
                const saveStart = server.clipRecords.length;
                const saveDeadline = Date.now() + STEP_TIMEOUT_MS;
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
                    `Save exceeded its ${STEP_TIMEOUT_MS / 1000}-second deadline`,
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
                if (kind === "effect-only") {
                    assert.equal(
                        reopened.project.sequence.events[0].kind,
                        "particle_vfx",
                    );
                    assert.equal(reopened.project.dependencies.length, 1);
                }
                receipts.push({
                    selection: labels[index],
                    app: app.role,
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
                // Unload the app but keep the tab until the context closes:
                // closing a tab that showed the app held up the next page
                // for 15-20 seconds on a two-core runner. A later failure
                // has no page of this clip to capture.
                await page.goto("about:blank");
                page = undefined;
                endPhase(`clip-${labels[index]}-${kind}`);
            }
        }
        assert.equal(receipts.length, selections.length * 2);
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
        // Sign out from the Library: drawing the Anima page's Avatar in
        // software WebGL slowed each step here to seconds.
        page = await context.newPage();
        await page.goto(server.origin + "/library");
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
        endPhase("clip-cleanup");
        return {
            selection_kind: selectionKind,
            mode: "v2-edited-data",
            minimum_edited_data_rollback_format: "animaPoseClip/2.0",
            exact_edited_data_rollback: applications.length === 2,
            format_generations: applications.map((app) => ({
                app: app.role,
                source_commit: app.manifest.source_commit,
                emitted_schema: "animaPoseClip/2.0",
            })),
            receipts,
            cleanup: [...ids.values()],
            remaining_owned_clips: 0,
            signed_out: true,
            first_point_playback_limit:
                "This fixture checks clip data semantics and emitted workers; it does not establish physical avatar/audio fidelity.",
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
