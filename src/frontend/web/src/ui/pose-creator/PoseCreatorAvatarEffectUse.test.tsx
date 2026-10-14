// @vitest-environment happy-dom
import type { AvatarEffectDefinitionV2 } from "@animama/runtime-contracts/api-types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnimaPoseClipAvatarVFXEvent } from "@/lib/avatar/poses/animaPoseClip";
import type { AnimaRuntimeCatalogSnapshot } from "@/lib/runtime-content/types";
import {
  DEFAULT_POSE_CREATOR_BASE_POSE,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import { createDefaultPoseCreatorClipDraft } from "./poseCreatorClipAuthoring";
import { PoseCreatorClipWorkspaceInspector } from "./PoseCreatorClipWorkspaceInspector";

const preview = vi.hoisted(() => ({
  runtime: null as AnimaRuntimeCatalogSnapshot | null,
}));
vi.mock("./PoseCreatorPreviewProvider", () => ({
  usePoseCreatorPreview: () => ({
    runtime: preview.runtime,
    eventCatalog: {
      avatarVFX: [
        { id: "star", label: "Kira Star", detail: "", soundOnApply: null },
      ],
      particleVFX: [],
      sceneBackground: [],
      sceneFocus: [],
      sfx: [],
      validationRefs: {},
    },
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const STAR: AvatarEffectDefinitionV2 = {
  schema: "animama/avatar-effect/2",
  region: "body",
  attachment: { kind: "body", bone: "head", size: 0.065 },
  art: { image: "kira_star.png" },
  soundAlias: "bell",
};

function snapshot(references: Record<string, string>) {
  const entry = (
    slot: "avatar_vfx" | "sfx",
    runtimeId: string,
    extra: object = {},
  ) => ({
    slot,
    runtime_id: runtimeId,
    kind: slot === "sfx" ? "audio" : "avatar_vfx",
    display_name: runtimeId,
    description: null,
    config_schema_version: 1,
    config: {},
    content_revision: "1",
    source: { type: "authorized_files", files: [] },
    ...extra,
  });
  return {
    effective_revision: "1",
    loadout_revision: 1,
    app_catalog_version: 1,
    avatar_model: null,
    idle_animations: [],
    gestures: [],
    poses: [],
    reactions: [],
    particle_vfx: [],
    avatar_vfx: [
      entry("avatar_vfx", "star", {
        definition: STAR,
        config: { runtime_reference_map: references },
      }),
    ],
    scene_background_vfx: [],
    scene_focus_vfx: [],
    background_image: null,
    profile_image: null,
    sfx: [
      entry("sfx", "sfx-bell", { display_name: "Bell" }),
      entry("sfx", "sfx-squeak", { display_name: "Squeak" }),
    ],
    warnings: [],
  } as AnimaRuntimeCatalogSnapshot;
}

function selectEvent(event: AnimaPoseClipAvatarVFXEvent) {
  const draft = createDefaultPoseCreatorClipDraft(
    DEFAULT_POSE_CREATOR_BASE_POSE,
  );
  usePoseCreatorStore.setState({
    authoringMode: "clip",
    clipInlineEdit: null,
    clipDraft: {
      ...draft,
      duration: 2,
      events: [event],
      selectedEventId: event.id,
    },
  });
}

function selectedEvent(): AnimaPoseClipAvatarVFXEvent {
  return usePoseCreatorStore.getState().clipDraft
    .events[0] as AnimaPoseClipAvatarVFXEvent;
}

const EVENT: AnimaPoseClipAvatarVFXEvent = {
  id: "evt_001",
  time: 0,
  kind: "avatar_vfx",
  effectId: "star",
};

describe("the event inspector's This use section", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    preview.runtime = snapshot({ bell: "sfx-bell" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () =>
    act(() =>
      root.render(<PoseCreatorClipWorkspaceInspector section="inspector" />),
    );
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    );

  it("offers the effect's placement controls and Reset only once changed", () => {
    selectEvent(EVENT);
    render();
    expect(container.textContent).toContain("This use");
    // The effect creator's "where" and Placement controls for a body point.
    expect(container.querySelector('[aria-label="Body point"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Rotation (°)"]'),
    ).not.toBeNull();
    expect(button("Reset to effect")).toBeUndefined();
    // One sound: no picker.
    expect(
      container.querySelector(
        '[aria-label="Accompanying sound for this event"]',
      ),
    ).toBeNull();
  });

  it("writes the smallest override for an edit and resets it", () => {
    selectEvent(EVENT);
    render();
    const rotation = container.querySelector<HTMLInputElement>(
      'input[aria-label="Rotation (°)"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(rotation, "30");
      rotation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(selectedEvent().override).toEqual({
      attachment: {
        kind: "body",
        bone: "head",
        size: 0.065,
        rotationDeg: 30,
      },
    });
    const reset = button("Reset to effect");
    expect(reset).toBeDefined();
    act(() => reset!.click());
    expect(selectedEvent()).not.toHaveProperty("override");
  });

  it("picks among the effect's declared sounds", () => {
    preview.runtime = snapshot({ bell: "sfx-bell", squeak: "sfx-squeak" });
    selectEvent({ ...EVENT, override: { soundAlias: "squeak" } });
    render();
    const picker = container.querySelector(
      '[aria-label="Accompanying sound for this event"]',
    );
    expect(picker?.textContent).toBe("Squeak");
    expect(button("Reset to effect")).toBeDefined();
  });

  it("explains a stored override the effect cannot play", () => {
    selectEvent({
      ...EVENT,
      override: {
        attachment: { kind: "sticker", around: "head" },
      } as AnimaPoseClipAvatarVFXEvent["override"],
    });
    render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This event's changes don't suit its effect",
    );
    expect(container.querySelector('[aria-label="Body point"]')).toBeNull();
    expect(button("Reset to effect")).toBeDefined();
  });

  it("is absent while the effect's definition is unavailable", () => {
    preview.runtime = null;
    selectEvent(EVENT);
    render();
    expect(container.textContent).not.toContain("This use");
  });
});
