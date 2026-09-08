import { describe, expect, it } from "vitest";

import {
  MEMORY_WORKSPACE_EXPLORER_COLLAPSED_PX,
  MEMORY_WORKSPACE_EXPLORER_MAX_PX,
  MEMORY_WORKSPACE_EXPLORER_MIN_PX,
  MEMORY_WORKSPACE_KEYBOARD_STEP_PX,
  MEMORY_WORKSPACE_PANE_MIN_PX,
  parseMemoryWorkspacePanePreference,
  resizeMemoryWorkspacePanePreference,
  resolveMemoryWorkspacePaneLayout,
  serializeMemoryWorkspacePanePreference,
  type MemoryWorkspacePanePreference,
} from "./workspace-pane-layout";

const preference: MemoryWorkspacePanePreference = {
  explorerRatio: 0.2,
  workShare: 0.6,
};

describe("memory workspace pane layout", () => {
  it("uses the bounded CSS-equivalent default and equal content panes", () => {
    const layout = resolveMemoryWorkspacePaneLayout({
      containerWidth: 1200,
      viewportWidth: 1600,
      preference: null,
      explorerCollapsed: false,
    });

    expect(layout.explorerWidth).toBe(240);
    expect(layout.workWidth).toBe(474);
    expect(layout.previewWidth).toBe(474);
  });

  it("parses only valid versioned preferences", () => {
    const serialized = serializeMemoryWorkspacePanePreference(preference);

    expect(parseMemoryWorkspacePanePreference(serialized)).toEqual(preference);
    expect(parseMemoryWorkspacePanePreference(null)).toBeNull();
    expect(parseMemoryWorkspacePanePreference("not json")).toBeNull();
    expect(
      parseMemoryWorkspacePanePreference(
        JSON.stringify({ version: 2, ...preference }),
      ),
    ).toBeNull();
    expect(
      parseMemoryWorkspacePanePreference(
        JSON.stringify({
          version: 1,
          explorerRatio: 2,
          workShare: 0.5,
        }),
      ),
    ).toBeNull();
  });

  it("clamps persisted proportions to all desktop pane minimums", () => {
    const layout = resolveMemoryWorkspacePaneLayout({
      containerWidth: 1400,
      preference: { explorerRatio: 0.7, workShare: 0.9 },
      explorerCollapsed: false,
    });

    expect(layout.explorerWidth).toBe(MEMORY_WORKSPACE_EXPLORER_MAX_PX);
    expect(layout.previewWidth).toBe(MEMORY_WORKSPACE_PANE_MIN_PX);
    expect(layout.workWidth).toBe(652);
  });

  it("reclamps the same preference as its container shrinks and grows", () => {
    const large = resolveMemoryWorkspacePaneLayout({
      containerWidth: 1600,
      preference,
      explorerCollapsed: false,
    });
    const small = resolveMemoryWorkspacePaneLayout({
      containerWidth: 700,
      preference,
      explorerCollapsed: false,
    });

    expect(large.explorerWidth).toBe(320);
    expect(
      large.workWidth + large.previewWidth + large.explorerWidth + 12,
    ).toBe(1600);
    expect(small.explorerWidth).toBe(140);
    expect(
      small.workWidth + small.previewWidth + small.explorerWidth + 12,
    ).toBe(700);
  });

  it("collapses to the rail without changing the restored preference", () => {
    const collapsed = resolveMemoryWorkspacePaneLayout({
      containerWidth: 1200,
      preference,
      explorerCollapsed: true,
    });
    const restored = resolveMemoryWorkspacePaneLayout({
      containerWidth: 1200,
      preference,
      explorerCollapsed: false,
    });

    expect(collapsed.explorerWidth).toBe(
      MEMORY_WORKSPACE_EXPLORER_COLLAPSED_PX,
    );
    expect(restored.explorerWidth).toBe(240);
  });

  it("applies keyboard-sized steps to either separator", () => {
    const layout = resolveMemoryWorkspacePaneLayout({
      containerWidth: 1200,
      preference: null,
      explorerCollapsed: false,
    });
    const explorerPreference = resizeMemoryWorkspacePanePreference({
      divider: "explorer",
      deltaPx: MEMORY_WORKSPACE_KEYBOARD_STEP_PX,
      containerWidth: 1200,
      layout,
      preference: null,
    });
    const workPreference = resizeMemoryWorkspacePanePreference({
      divider: "work",
      deltaPx: MEMORY_WORKSPACE_KEYBOARD_STEP_PX,
      containerWidth: 1200,
      layout,
      preference: null,
    });

    expect(
      resolveMemoryWorkspacePaneLayout({
        containerWidth: 1200,
        preference: explorerPreference,
        explorerCollapsed: false,
      }).explorerWidth,
    ).toBe(layout.explorerWidth + MEMORY_WORKSPACE_KEYBOARD_STEP_PX);
    expect(
      resolveMemoryWorkspacePaneLayout({
        containerWidth: 1200,
        preference: workPreference,
        explorerCollapsed: false,
      }).workWidth,
    ).toBe(layout.workWidth + MEMORY_WORKSPACE_KEYBOARD_STEP_PX);
  });

  it("keeps the full explorer and content minimums when space allows", () => {
    const layout = resolveMemoryWorkspacePaneLayout({
      containerWidth:
        MEMORY_WORKSPACE_EXPLORER_MIN_PX +
        MEMORY_WORKSPACE_PANE_MIN_PX * 2 +
        12,
      viewportWidth: 800,
      preference: null,
      explorerCollapsed: false,
    });

    expect(layout.explorerWidth).toBe(MEMORY_WORKSPACE_EXPLORER_MIN_PX);
    expect(layout.workWidth).toBe(MEMORY_WORKSPACE_PANE_MIN_PX);
    expect(layout.previewWidth).toBe(MEMORY_WORKSPACE_PANE_MIN_PX);
  });
});
