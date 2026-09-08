import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireContentPreviewResource,
  contentPreviewLifecycleSnapshot,
  logContentPreviewLifecycle,
  resetContentPreviewLifecycleForTests,
} from "./lifecycle";

describe("asset preview lifecycle counters", () => {
  beforeEach(resetContentPreviewLifecycleForTests);

  it("shows exclusive renderer resources and idempotent final disposal", () => {
    const releaseCanvas = acquireContentPreviewResource("dock", "canvas");
    const releaseAvatar = acquireContentPreviewResource("dock", "avatar");
    const releaseCatalog = acquireContentPreviewResource("dock", "catalog");
    expect(contentPreviewLifecycleSnapshot()).toMatchObject({
      totalCanvases: 1,
      totalAvatars: 1,
      totalCatalogs: 1,
    });

    releaseCatalog();
    releaseAvatar();
    releaseCanvas();
    releaseCanvas();
    expect(contentPreviewLifecycleSnapshot()).toMatchObject({
      totalCanvases: 0,
      totalAvatars: 0,
      totalCatalogs: 0,
    });
  });

  it("tracks creator canvases in the shared ownership snapshot", () => {
    const release = acquireContentPreviewResource("creator", "canvas");
    expect(contentPreviewLifecycleSnapshot()).toMatchObject({
      creator: { canvas: 1 },
      totalCanvases: 1,
    });
    release();
    expect(contentPreviewLifecycleSnapshot().totalCanvases).toBe(0);
  });

  it("logs only the bounded lifecycle fields supplied by callers", () => {
    const debug = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
    logContentPreviewLifecycle("preview_open", "dock", {
      kind: "animation",
      slot: "gesture",
      sourceType: "catalog",
    });

    expect(debug).toHaveBeenCalledWith("[content-preview] lifecycle", {
      event: "preview_open",
      owner: "dock",
      kind: "animation",
      slot: "gesture",
      sourceType: "catalog",
    });
  });
});
