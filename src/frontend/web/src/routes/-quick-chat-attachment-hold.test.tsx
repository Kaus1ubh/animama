// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route as QuickChatRoute } from "./desktop/quick-chat/$animaId";

const fixture = vi.hoisted(() => ({
  sendCommand: vi.fn(),
  toastError: vi.fn(),
  snapshot: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ animaId: "annie" }),
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: fixture.toastError }),
}));
vi.mock("@/hooks/useDesktopQuickChatRuntime", () => ({
  useDesktopQuickChatConsumer: () => ({
    close: vi.fn(),
    focusInputSignal: 0,
    sendCommand: fixture.sendCommand,
    snapshot: fixture.snapshot,
  }),
  useDesktopQuickChatInteractiveRegions: () => {},
  usePauseClosedQuickChatAnimations: () => {},
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => ({
    kind: "desktop",
    desktopBridge: { windowRole: "quick-chat" },
  }),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/ui/safety/CompanionSafetyView", () => ({
  CompanionSafetyView: () => null,
}));
// The composer is a fixture: it shows the draft and the hold, and sends.
vi.mock("@/ui/main/chat/ChatInterface", () => ({
  ChatInterfaceView: ({
    attachmentHold,
    input,
    onSubmit,
  }: {
    attachmentHold: string;
    input: string;
    onSubmit: () => void;
  }) => (
    <div>
      <output data-draft="">{input}</output>
      <output data-hold="">{attachmentHold}</output>
      <button type="button" onClick={onSubmit}>
        Send
      </button>
    </div>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DRAFT = "Summarize the report";
let root: Root | null = null;

function render(attachmentHold: string) {
  fixture.snapshot = {
    activeChat: null,
    animaId: "annie",
    attachmentHold,
    chatId: null,
    input: DRAFT,
    inputPlaceholder: "",
    canChat: true,
    isStreaming: false,
    isAwaitingStreamingAnimationFinalization: false,
    displayMessages: [],
    promptSuggestions: [],
    showPromptSuggestions: false,
    voice: { activeMode: null },
  };
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(createElement(QuickChatRoute.options.component!));
  });
  return {
    draft: () => container.querySelector("[data-draft]")?.textContent,
    hold: () => container.querySelector("[data-hold]")?.textContent,
    send: () => act(() => container.querySelector("button")?.click()),
  };
}

beforeEach(() => {
  fixture.sendCommand.mockReset();
  fixture.toastError.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Quick Chat attachment hold", () => {
  it("keeps a draft the main window's uploads hold and says why", () => {
    const quickChat = render("waiting");
    expect(quickChat.hold()).toBe("waiting");

    quickChat.send();

    expect(quickChat.draft()).toBe(DRAFT);
    expect(fixture.sendCommand).not.toHaveBeenCalled();
    expect(fixture.toastError).toHaveBeenCalledWith(
      "Attached files are not ready yet.",
    );
  });

  it("asks for unreadable files to be removed", () => {
    const quickChat = render("blocked");

    quickChat.send();

    expect(quickChat.draft()).toBe(DRAFT);
    expect(fixture.sendCommand).not.toHaveBeenCalled();
    expect(fixture.toastError).toHaveBeenCalledWith(
      "Remove unreadable files before sending.",
    );
  });

  it("sends the draft once nothing holds it", () => {
    const quickChat = render("none");

    quickChat.send();

    expect(fixture.sendCommand).toHaveBeenCalledWith({
      type: "submit-text",
      text: DRAFT,
    });
    expect(quickChat.draft()).toBe("");
    expect(fixture.toastError).not.toHaveBeenCalled();
  });
});
