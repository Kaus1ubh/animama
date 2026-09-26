import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./copy-text";

/** Minimal DOM: a focused button inside a dialog, and execCommand. */
function installDom({ execResult }: { execResult: boolean | "throw" }) {
  const appended: Array<{ value: string; removed: boolean }> = [];
  const dialog = {
    appendChild: vi.fn((node: { value: string }) => {
      appended.push(node as never);
    }),
  };
  const button = {
    focus: vi.fn(),
    closest: vi.fn(() => dialog),
  };
  class FakeHTMLElement {}
  Object.setPrototypeOf(button, FakeHTMLElement.prototype);
  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("document", {
    activeElement: button,
    body: { appendChild: vi.fn() },
    createElement: () => {
      const node = {
        value: "",
        style: { cssText: "" },
        removed: false,
        selectionStart: 0,
        selectionEnd: 0,
        setAttribute: vi.fn(),
        select() {
          node.selectionStart = 0;
          node.selectionEnd = node.value.length;
        },
        remove() {
          node.removed = true;
        },
      };
      return node;
    },
    execCommand: vi.fn(() => {
      if (execResult === "throw") throw new Error("unsupported");
      return execResult;
    }),
  });
  return { appended, dialog, button };
}

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("uses the Clipboard API when it is allowed", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("summary")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("summary");
  });

  it("falls back to a selected textarea inside the open dialog when denied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("Write permission denied");
        },
      },
    });
    const { appended, dialog, button } = installDom({ execResult: true });
    await expect(copyText("summary")).resolves.toBe(true);
    expect(dialog.appendChild).toHaveBeenCalledTimes(1);
    expect(appended[0]).toMatchObject({ value: "summary", removed: true });
    expect(button.focus).toHaveBeenCalled();
  });

  it("reports failure and cleans up when the fallback cannot copy", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    const { appended } = installDom({ execResult: "throw" });
    await expect(copyText("summary")).resolves.toBe(false);
    expect(appended[0]?.removed).toBe(true);
  });
});
