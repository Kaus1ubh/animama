// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hostedExclusionReasons } from "@/app/runtime/route-admission";
import {
  normalizeContentLibrarySearch,
  type ContentLibrarySearch,
} from "@/lib/content/librarySearch";
import { withRuntime } from "@/test/runtime-markup";
import { LibraryPage } from "./LibraryPage";

const fixture = vi.hoisted(() => ({
  capabilities: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: fixture.capabilities }),
}));
vi.mock("@/query/hooks/useLibrarySharingFlow", () => ({
  useLibrarySharingFlow: () => ({}),
}));
vi.mock("./LibrarySharingDialog", () => ({
  LibrarySharingDialog: () => null,
}));
vi.mock("@/ui/app/AppShellPage", () => ({
  AppShellPage: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/ui/app/AppShell", () => ({ useOptionalAppShell: () => null }));
vi.mock("@/ui/content-health/ContentHealth", () => ({
  ContentHealth: () => null,
}));
vi.mock("@/ui/library/LibraryChatUploads", () => ({
  LibraryChatUploads: () => <p>Upload management</p>,
}));
vi.mock("@/ui/library/LibraryContentInventory", () => ({
  LibraryContentInventory: () => <p>Content inventory</p>,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HOSTED = {
  chat_file_uploads: false,
  user_file_processing: { enabled: false },
};

function mount(search: Partial<ContentLibrarySearch> = {}) {
  const onSearchChange = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      withRuntime(
        <LibraryPage
          search={normalizeContentLibrarySearch(search)}
          onSearchChange={onSearchChange}
        />,
      ),
    );
  });
  const tab = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Library sections"] button',
    ),
  ).find((button) => button.textContent === "Chat Uploads");
  return {
    container,
    onSearchChange,
    tab,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("Library Chat Uploads entry points", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    fixture.capabilities = undefined;
  });

  it("keep the offered Chat Uploads tab and section unchanged", () => {
    fixture.capabilities = {
      chat_file_uploads: true,
      user_file_processing: { enabled: true },
    };
    const view = mount({ section: "chat-uploads" });
    cleanup = view.unmount;
    expect(view.tab?.hasAttribute("aria-disabled")).toBe(false);
    expect(view.container.textContent).toContain("Upload management");
    act(() => view.tab!.click());
    expect(view.onSearchChange).toHaveBeenCalledWith({
      section: "chat-uploads",
    });
  });

  it("hide the tab while capabilities are unknown", () => {
    const view = mount();
    cleanup = view.unmount;
    expect(view.tab).toBeUndefined();
  });

  it("keep a disabled tab described by the shared reason when uploads are withheld", () => {
    fixture.capabilities = HOSTED;
    const view = mount();
    cleanup = view.unmount;
    expect(view.tab?.getAttribute("aria-disabled")).toBe("true");
    const reasonId = view.tab?.getAttribute("aria-describedby");
    expect(document.getElementById(reasonId!)?.textContent).toBe(
      hostedExclusionReasons.chat_file_uploads,
    );
    act(() => view.tab!.click());
    expect(view.onSearchChange).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Content inventory");
  });

  it("explain uploads and document processing on a direct Chat Uploads link", () => {
    fixture.capabilities = HOSTED;
    const view = mount({ section: "chat-uploads" });
    cleanup = view.unmount;
    const text = view.container.textContent ?? "";
    expect(text).toContain("Chat Uploads unavailable");
    expect(text).toContain(hostedExclusionReasons.chat_file_uploads);
    expect(text).toContain(hostedExclusionReasons.document_processing);
    expect(text).not.toContain("Upload management");
    const back = Array.from(view.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Back to Library",
    );
    act(() => back!.click());
    expect(view.onSearchChange).toHaveBeenCalledWith({ section: "all" });
  });
});
