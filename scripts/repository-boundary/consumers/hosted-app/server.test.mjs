import assert from "node:assert/strict";
import test from "node:test";
import {
    applicationRoute,
    applyFixtureOwnerDefaults,
    createApplicationServer,
} from "./server.mjs";

test("a new fixture owner starts with Text-to-Speech and enhanced rendering off", () => {
    assert.deepEqual(applyFixtureOwnerDefaults({}), {
        speech: { tts_enabled: false },
        presentation: { enhanced_rendering: false },
    });
    assert.deepEqual(
        applyFixtureOwnerDefaults({ presentation: { render_markdown: false } })
            .presentation,
        { render_markdown: false, enhanced_rendering: false },
        "The rendering default keeps the owner's other presentation choices",
    );
});

test("a returning fixture owner keeps the settings it saved", () => {
    const saved = {
        speech: { tts_enabled: true, tts_provider: "pocket" },
        presentation: { enhanced_rendering: true, render_markdown: false },
    };
    assert.deepEqual(applyFixtureOwnerDefaults(structuredClone(saved)), saved);
});

test("the shared router and its legacy redirects have closed deep-link fallback", () => {
    for (const route of [
        "/",
        "/create",
        "/library",
        "/memories",
        "/animas/new",
        "/animas/owner-anima/identity",
        "/gestures/new",
        "/poses/fixture/edit",
        "/reactions/new",
        "/particle-effects/new",
        "/avatar-effects",
        "/avatar-effects/fixture/edit",
        "/scene-effects",
        "/sound-effects/new",
        "/owner-anima/c/turn",
        "/a/create",
        "/a/library",
        "/a/particle-effects/new",
        "/desktop/pip/owner-anima",
    ]) {
        assert.equal(applicationRoute(route), true, route);
    }
    for (const route of [
        "/src/main.hosted.tsx",
        "/v1/content/files/missing",
        "/api/cloud/auth/session",
        "/_animama/static/missing/file.js",
        "/catalog-seed/manifest.json",
        "/missing-model.onnx",
        "/avatar-portrait-debug",
        "/a/v1/private",
        "/a/missing-resource.wasm",
        "/library/extra",
        "/create/extra",
        "/idle-styles/new",
        "/idle-styles/fixture/edit",
    ]) {
        assert.equal(applicationRoute(route), false, route);
    }
});

test("a retained immutable URL cannot be overwritten by a new selection", async () => {
    const app = (hash) => ({
        directory: "unused",
        manifest: {
            files: [{ path: "_animama/static/fixed/app.js", sha256: hash }],
        },
    });
    await assert.rejects(
        createApplicationServer([app("a"), app("b")]),
        /Immutable URL reused/,
    );
});
