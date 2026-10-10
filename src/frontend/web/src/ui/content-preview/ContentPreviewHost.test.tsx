// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { getI18n } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { withRuntime } from "@/test/runtime-markup";
import { ContentPreviewHost } from "./ContentPreviewHost";

const fixture = vi.hoisted(() => {
  const target = {
    key: "wave:revision-1",
    kind: "animation",
    displayName: "Wave",
    sourceType: "resolved_entry",
    slot: "gesture",
    runtimeId: "primary",
    configSchemaVersion: 1,
    config: {},
    entry: {},
    animaContext: { animaId: "anima-1", runtime: {} },
  };
  return {
    target,
    preparation: {
      prepared: {
        target,
        runtime: { avatar_model: {} },
        entry: {},
        entryKey: "wave",
      },
      error: null,
      isPending: false,
      retry: async () => undefined,
    },
    /** Each render's `onStatusChange`, as the scene's effects receive it. */
    statusCallbacks: [] as unknown[],
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: PropsWithChildren) => <a>{children}</a>,
}));
vi.mock("./ContentPreviewDockProvider", () => ({
  useContentPreviewDock: () => ({
    target: fixture.target,
    view: "docked",
    minimize: () => undefined,
    restore: () => undefined,
    toggleExpanded: () => undefined,
    expireSession: () => undefined,
    returnFocusToInvoker: () => undefined,
  }),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({ userSettings: null, isLoading: false }),
}));
vi.mock("@/query/hooks/useAnimas", () => ({
  useAnimas: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock("@/query/hooks/useAnimaRuntimeCatalog", () => ({
  useAnimaRuntimeCatalog: () => ({
    data: undefined,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("./usePreparedContentPreview", () => ({
  usePreparedContentPreview: () => fixture.preparation,
}));
vi.mock("@/lib/runtime-content/AnimaRuntimeCatalog", () => ({
  AnimaRuntimeCatalog: class {
    dispose() {}
  },
}));
vi.mock("./ContentPreviewScene", () => ({
  ContentPreviewScene: ({ onStatusChange }: { onStatusChange: unknown }) => {
    fixture.statusCallbacks.push(onStatusChange);
    return null;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ContentPreviewHost", () => {
  it("keeps the scene's status callback across a UI Locale change", async () => {
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(withRuntime(<ContentPreviewHost />)));
    const rendered = fixture.statusCallbacks.length;
    expect(rendered).toBeGreaterThan(0);
    try {
      // A new callback would rerun the scene's Avatar load and playback
      // effects, leaving playback at "Preparing".
      await act(async () => {
        await getI18n().changeLanguage("ja");
      });
      expect(fixture.statusCallbacks.length).toBeGreaterThan(rendered);
      expect(new Set(fixture.statusCallbacks).size).toBe(1);
    } finally {
      await act(async () => {
        await getI18n().changeLanguage("en");
      });
      act(() => root.unmount());
    }
  });
});
