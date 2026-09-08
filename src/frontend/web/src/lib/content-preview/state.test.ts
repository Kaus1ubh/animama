import { describe, expect, it } from "vitest";

import {
  INITIAL_CONTENT_PREVIEW_DOCK_STATE,
  clampContentPreviewPosition,
  reduceContentPreviewDockState,
  reduceContentPreviewView,
  shouldArmContentPreviewIdleTimer,
} from "./state";
import type { ContentPreviewTarget } from "./types";

const TARGET: ContentPreviewTarget = {
  key: "app:idle-angry:1",
  kind: "animation",
  displayName: "Idle Angry",
  versionLabel: "Built-in v1",
  slot: "idle_animation",
  runtimeId: "idle_angry",
  configSchemaVersion: 1,
  config: {},
  sourceType: "resolved_entry",
  entry: {
    slot: "idle_animation",
    runtime_id: "idle_angry",
    kind: "animation",
    display_name: "Idle Angry",
    description: null,
    config_schema_version: 1,
    config: {},
    content_revision: "builtin:idle-angry:1",
    source: { type: "public_url", url: "/vrm/animations/idle_angry.vrma" },
  },
};

describe("Asset preview view state", () => {
  it("moves through docked, expanded, minimized, restored, and hidden", () => {
    expect(reduceContentPreviewView("hidden", "open")).toBe("docked");
    expect(reduceContentPreviewView("docked", "toggle_expand")).toBe(
      "expanded",
    );
    expect(reduceContentPreviewView("expanded", "minimize")).toBe("minimized");
    expect(reduceContentPreviewView("minimized", "restore")).toBe("docked");
    expect(reduceContentPreviewView("docked", "close")).toBe("hidden");
  });

  it("preserves expanded presentation when a new target opens", () => {
    expect(reduceContentPreviewView("expanded", "open")).toBe("expanded");
  });

  it("arms eviction only for initialized hidden or minimized sessions", () => {
    expect(shouldArmContentPreviewIdleTimer(false, "hidden")).toBe(false);
    expect(shouldArmContentPreviewIdleTimer(true, "hidden")).toBe(true);
    expect(shouldArmContentPreviewIdleTimer(true, "minimized")).toBe(true);
    expect(shouldArmContentPreviewIdleTimer(true, "docked")).toBe(false);
    expect(shouldArmContentPreviewIdleTimer(true, "expanded")).toBe(false);
  });

  it("keeps dragged floating and minimized surfaces inside the viewport", () => {
    expect(
      clampContentPreviewPosition(
        { x: -40, y: 760 },
        { width: 400, height: 300 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ x: 8, y: 492 });
    expect(
      clampContentPreviewPosition(
        { x: 1100, y: -20 },
        { width: 384, height: 56 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ x: 808, y: 8 });
  });

  it("disposes an initialized Library Dock before granting management ownership", () => {
    const library = reduceContentPreviewDockState(
      INITIAL_CONTENT_PREVIEW_DOCK_STATE,
      { type: "open", target: TARGET },
    );
    const management = reduceContentPreviewDockState(library, {
      type: "claim_management",
      ownerId: "anima-management:one",
    });

    expect(management).toEqual({
      target: null,
      view: "hidden",
      initialized: false,
      managementOwnerId: "anima-management:one",
    });
    expect(
      reduceContentPreviewDockState(management, {
        type: "open",
        target: TARGET,
      }),
    ).toBe(management);
  });

  it("releases management ownership without eagerly recreating the Dock", () => {
    const claimed = reduceContentPreviewDockState(
      INITIAL_CONTENT_PREVIEW_DOCK_STATE,
      { type: "claim_management", ownerId: "anima-management:one" },
    );
    const released = reduceContentPreviewDockState(claimed, {
      type: "release_management",
      ownerId: "anima-management:one",
    });

    expect(released).toEqual(INITIAL_CONTENT_PREVIEW_DOCK_STATE);
    expect(
      reduceContentPreviewDockState(released, { type: "open", target: TARGET }),
    ).toMatchObject({ initialized: true, target: TARGET, view: "docked" });
  });

  it("keeps a rapid Anima switch safe from stale release effects", () => {
    const first = reduceContentPreviewDockState(
      INITIAL_CONTENT_PREVIEW_DOCK_STATE,
      { type: "claim_management", ownerId: "anima-management:one" },
    );
    const second = reduceContentPreviewDockState(first, {
      type: "claim_management",
      ownerId: "anima-management:two",
    });
    const staleRelease = reduceContentPreviewDockState(second, {
      type: "release_management",
      ownerId: "anima-management:one",
    });

    expect(staleRelease).toBe(second);
    expect(staleRelease.managementOwnerId).toBe("anima-management:two");
  });

  it("makes duplicate Strict Mode claims and releases idempotent", () => {
    const claimed = reduceContentPreviewDockState(
      INITIAL_CONTENT_PREVIEW_DOCK_STATE,
      { type: "claim_management", ownerId: "anima-management:one" },
    );
    const claimedAgain = reduceContentPreviewDockState(claimed, {
      type: "claim_management",
      ownerId: "anima-management:one",
    });
    const released = reduceContentPreviewDockState(claimedAgain, {
      type: "release_management",
      ownerId: "anima-management:one",
    });

    expect(claimedAgain).toBe(claimed);
    expect(released).toEqual(INITIAL_CONTENT_PREVIEW_DOCK_STATE);
  });
});
