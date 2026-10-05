import type { ReactNode } from "react";
import { renderToString } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseEditorWorkspace } from "./PoseEditorPage";

const harness = vi.hoisted(() => ({
  desktop: true,
  saving: 0,
  guard: null as null | {
    shouldBlockFn: (input: {
      current: { pathname: string };
      next: { pathname: string };
    }) => boolean;
    enableBeforeUnload: () => boolean;
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
    snapshot(),
}));
vi.mock("@/stores/pose-creator-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/pose-creator-store")>();
  return {
    ...actual,
    usePoseCreatorStore: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.usePoseCreatorStore.getState>,
        ) => unknown,
      ) => selector(actual.usePoseCreatorStore.getState()),
      actual.usePoseCreatorStore,
    ),
  };
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    "aria-label": label,
  }: {
    children: ReactNode;
    to: string;
    "aria-label": string;
  }) => (
    <a href={to} aria-label={label}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useBlocker: (guard: typeof harness.guard) => {
    harness.guard = guard;
    return { status: "idle" };
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useIsMutating: () => harness.saving,
}));
vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeCacheKey: () => "owner",
}));
vi.mock("@/query/hooks/usePoses", () => ({
  usePose: () => ({
    isPending: true,
    data: undefined,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/ui/action-editor/useActionEditorDesktopLayout", () => ({
  useActionEditorDesktopLayout: () => harness.desktop,
}));
vi.mock("./PoseEditorScene", () => ({
  PoseEditorScene: () => <div data-scene="pose" />,
}));
vi.mock("@/ui/pose-creator/PoseCreatorLibrarySection", () => ({
  PoseCreatorLibrarySection: ({ hideNew }: { hideNew: boolean }) => (
    <div data-pose-toolbar={hideNew ? "item-only" : "new-allowed"} />
  ),
}));
vi.mock("@/ui/pose-creator/PosePrimaryActions", () => ({
  PosePrimaryActions: () => <button>Save pose</button>,
}));
vi.mock("@/ui/pose-creator/PoseCreatorBoneSection", () => ({
  PoseCreatorBoneSection: ({ variant }: { variant: string }) => (
    <div data-bones={variant} />
  ),
}));
vi.mock("@/ui/pose-creator/PoseCreatorExpressionSection", () => ({
  PoseCreatorExpressionSection: () => <div data-expressions />,
}));
vi.mock("@/ui/pose-creator/PoseCreatorPreviewSettingsPanel", () => ({
  PoseCreatorPreviewSettingsPanel: () => <div data-preview-settings />,
}));

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  harness.desktop = true;
  harness.saving = 0;
  harness.guard = null;
});

describe("Pose editor composition", () => {
  it.each([true, false])(
    "mounts one pose canvas and no Action/New control (desktop=%s)",
    (desktop) => {
      harness.desktop = desktop;
      const html = renderToString(<PoseEditorWorkspace poseId="pose-item" />);
      expect(html.match(/data-scene="pose"/g)).toHaveLength(1);
      expect(html.match(/data-bones=/g)).toHaveLength(1);
      expect(html).toContain('data-pose-toolbar="item-only"');
      expect(html).toContain('aria-label="Back to Poses"');
      expect(html).toContain("Pose editor");
      expect(html).toContain('data-testid="pose-editor-workspace"');
      expect(html).toContain("--app-shell-sidebar-inset:0px");
      expect(html).not.toContain("Timeline");
      expect(html.includes('aria-label="Pose tools"')).toBe(!desktop);
    },
  );

  it.each(["dirty", "saving"])(
    "guards navigation and closing while %s",
    (condition) => {
      if (condition === "dirty") usePoseCreatorStore.getState().setDirty(true);
      else harness.saving = 1;
      renderToString(<PoseEditorWorkspace poseId="pose-item" />);
      const path = "/poses/pose-item/edit";
      expect(
        harness.guard?.shouldBlockFn({
          current: { pathname: path },
          next: { pathname: "/library" },
        }),
      ).toBe(true);
      expect(
        harness.guard?.shouldBlockFn({
          current: { pathname: path },
          next: { pathname: path },
        }),
      ).toBe(false);
      expect(harness.guard?.enableBeforeUnload()).toBe(true);
    },
  );
});
