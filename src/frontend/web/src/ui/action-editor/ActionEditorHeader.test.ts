import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  actionHeaderStatus,
  actionSaveDisabled,
  actionSaveErrorLabel,
} from "./ActionEditorHeader";

describe("action creator header status", () => {
  it("does not call a new document saved merely because it is clean", () => {
    expect(
      actionHeaderStatus({
        dirty: false,
        hasReadyItem: false,
        stage: "idle",
      }),
    ).toEqual({ state: "unsaved", label: "Unsaved" });
  });

  it("surfaces upload/save progress before saved state", () => {
    expect(
      actionHeaderStatus({
        dirty: false,
        hasReadyItem: true,
        stage: "uploading",
      }),
    ).toEqual({ state: "saving", label: "Uploading" });
    expect(
      actionHeaderStatus({
        dirty: false,
        hasReadyItem: true,
        stage: "saving",
      }),
    ).toEqual({ state: "saving", label: "Saving" });
    expect(
      actionHeaderStatus({
        dirty: false,
        hasReadyItem: true,
        stage: "updating_animas",
      }),
    ).toEqual({ state: "saving", label: "Updating Animas" });
    expect(
      actionHeaderStatus({
        dirty: false,
        hasReadyItem: true,
        stage: "idle",
      }),
    ).toEqual({ state: "saved", label: "Saved" });
  });
});

describe("action creator save controls", () => {
  it("blocks only in-flight and unchanged saved items", () => {
    expect(
      actionSaveDisabled({
        busy: true,
        hasReadyItem: false,
        dirty: true,
      }),
    ).toBe(true);
    expect(
      actionSaveDisabled({
        busy: false,
        hasReadyItem: false,
        dirty: true,
      }),
    ).toBe(false);
    expect(
      actionSaveDisabled({
        busy: false,
        hasReadyItem: true,
        dirty: false,
      }),
    ).toBe(true);
  });

  it("allows a valid new or changed document to save", () => {
    expect(
      actionSaveDisabled({
        busy: false,
        hasReadyItem: false,
        dirty: false,
      }),
    ).toBe(false);
    expect(
      actionSaveDisabled({
        busy: false,
        hasReadyItem: true,
        dirty: true,
      }),
    ).toBe(false);
  });

  it("announces the actionable failure from the red indicator", () => {
    expect(
      actionSaveErrorLabel(
        "This item changed since you opened it. Your draft is preserved.",
      ),
    ).toBe(
      "Save failed: This item changed since you opened it. Your draft is preserved.",
    );
  });
});

describe("action creator preview ownership", () => {
  it("keeps playback in the local timeline instead of the document toolbar", async () => {
    const [header, page, scene, actions, timeline] = await Promise.all([
      readFile(new URL("./ActionEditorHeader.tsx", import.meta.url), "utf8"),
      readFile(new URL("./ActionEditorPage.tsx", import.meta.url), "utf8"),
      readFile(new URL("./ActionEditorScene.tsx", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../../query/mutations/useActionEditorActions.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../pose-creator/PoseCreatorClipTimeline.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(header).not.toContain('label="Preview"');
    expect(header).not.toContain("workspace.preview()");
    expect(page).not.toContain("actions.preview");
    expect(scene).not.toContain("playContentPreviewMotion");
    expect(actions).not.toContain("const preview = useMutation");
    // Accessible transport controls are covered by CreatorTimeline.test.tsx.
    expect(timeline).toContain("<CreatorTimelineTransport");
  });
});
