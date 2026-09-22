import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeContentLibrarySearch } from "@/lib/content/librarySearch";
import { LibraryContentInventory } from "./LibraryContentInventory";
const mocks = vi.hoisted(() => ({
  poseInput: vi.fn(),
  open: vi.fn(),
  preview: null as (() => void) | null,
}));
const items = [
  {
    item_id: "starter",
    pose_id: "builtin:pose:salute",
    name: "Salute",
    source: "included",
    editable: false,
    revision_sha256: "r1",
  },
  {
    item_id: "mine",
    pose_id: "local:pose:wave",
    name: "My Wave",
    source: "local",
    editable: true,
    revision_sha256: "r2",
  },
];
vi.mock("@/query/hooks/usePoses", () => ({
  usePoses: (input: unknown) => {
    mocks.poseInput(input);
    return { data: { items }, isPending: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock("@/query/hooks/useActions", () => ({
  useGestures: () => ({}),
  useReactions: () => ({}),
}));
vi.mock("@/query/hooks/useEffects", () => ({
  useEffects: () => ({ particles: {}, sounds: {}, avatars: {}, scenes: {} }),
}));
vi.mock("@/query/hooks/useAvatarCatalog", () => ({
  useAvatarCatalog: () => ({}),
}));
vi.mock("@/ui/content-preview/ContentPreviewDockProvider", () => ({
  useContentPreviewDock: () => ({ openPreview: mocks.open }),
}));
vi.mock("@/ui/content-preview/useContentPreviewAudio", () => ({
  useContentPreviewAudio: () => ({}),
}));
vi.mock("@/ui/action-manage/ActionManageDialog", () => ({
  ActionManageDialog: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => {
    if (onClick && Array.isArray(children) && children.includes(" Preview"))
      mocks.preview ??= onClick;
    return <button {...props}>{children}</button>;
  },
}));
beforeEach(() => {
  mocks.poseInput.mockClear();
  mocks.open.mockClear();
  mocks.preview = null;
});
describe("Library Poses", () => {
  it("renders Starter customization and Local editing with no equipment or creation action", () => {
    const html = renderToString(
      <LibraryContentInventory
        search={normalizeContentLibrarySearch({
          section: "actions",
          action: "poses",
          query: "wave",
          showStarters: false,
        })}
        onSearchChange={() => {}}
      />,
    );
    expect(html).toContain('id="library-poses-heading"');
    expect(html).toContain('aria-label="Salute"');
    expect(html).toContain("Starter");
    expect(html).toContain("Local");
    expect(html).toContain('href="/a/poses/starter/edit"');
    expect(html).toContain("Customize");
    expect(html).toContain('href="/a/poses/mine/edit"');
    expect(html).toContain("Edit");
    expect(html).not.toMatch(
      /New Pose|Add \/ Manage|Use in Reaction|Use in Gesture/,
    );
    expect(mocks.poseInput).toHaveBeenCalledWith({
      query: "wave",
      origin: "owned",
      enabled: true,
    });
    expect(mocks.preview).not.toBeNull();
    mocks.preview!();
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "pose_content", item: items[0] }),
    );
  });
  it("requests Poses in the combined All inventory", () => {
    renderToString(
      <LibraryContentInventory
        search={normalizeContentLibrarySearch({})}
        onSearchChange={() => {}}
      />,
    );
    expect(mocks.poseInput).toHaveBeenCalledWith({
      query: undefined,
      origin: "all",
      enabled: true,
    });
  });
});
