// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@animama/product-ui/chat";
import { ChatConversation } from "@animama/product-ui/components";
import { defaultRehypePlugins } from "streamdown";

import { MEMORY_MANAGER_MARKDOWN_ANIMATION } from "@/lib/memory-manager/transcript-projection";

import { Response } from "./streamdown-response";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

/** A settled assistant reply in the chat transcript, rendered as markdown. */
function chatReply(text: string) {
  const messages: ChatMessage[] = [
    { id: "run-1:assistant", role: "assistant", text },
  ];
  return mount(<ChatConversation messages={messages} markdownEnabled />);
}

/** A streaming Memory Manager reply, with the panel's markdown props. */
function managerReply(text: string) {
  return mount(
    <Response
      animated={MEMORY_MANAGER_MARKDOWN_ANIMATION}
      isAnimating
      parseMarkdownIntoBlocksFn={(markdown) => [markdown]}
    >
      {text}
    </Response>,
  );
}

/** Every URL the rendered markdown asks the browser to load. */
function loadedSources(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[src], [srcset]")).flatMap(
    (element) =>
      [element.getAttribute("src"), element.getAttribute("srcset")].filter(
        (value): value is string => value !== null,
      ),
  );
}

const remoteImages = [
  "Inline ![chart](https://images.example/chart.png?d=1).",
  "",
  "Reference ![ref][chart]. Linked [![badge](https://images.example/badge.png)](https://site.example/).",
  "",
  "Encoded ![encoded](https&#58;//images.example/encoded.png).",
  "",
  '<img src="https://images.example/raw.png" alt="raw">',
  "",
  '<picture><source srcset="https://images.example/source.png"></picture>',
  "",
  "[chart]: https://images.example/ref.png",
].join("\n");

/** Remote sources written so that a loose check might read them as local. */
const disguisedRemoteImages = [
  "![relative](//images.example/protocol-relative.png)",
  "![upper](HTTPS://IMAGES.EXAMPLE/upper.png)",
  "![slash](/\\images.example/backslash.png)",
].join("\n\n");

describe.each([
  ["chat", chatReply],
  ["Memory Manager", managerReply],
])("markdown images in a %s reply", (_surface, render) => {
  it("shows a remote image as its alt text, never as an image", () => {
    const container = render(remoteImages);
    expect(loadedSources(container)).toEqual([]);
    expect(container.querySelector("img, picture, source")).toBeNull();
    for (const alt of ["chart", "ref", "badge", "encoded"]) {
      expect(container.textContent).toContain(`[Image: ${alt}]`);
    }
  });

  it("loads a disguised remote source only from the app's own origin", () => {
    const container = render(disguisedRemoteImages);
    for (const source of loadedSources(container)) {
      expect(new URL(source, document.baseURI).origin).toBe(
        window.location.origin,
      );
    }
  });

  it("still shows images the app serves itself", () => {
    const sameOrigin = `${window.location.origin}/assets/included.png`;
    const container = render(
      `![portrait](/v1/content/files/portrait.png) ![included](${sameOrigin})`,
    );
    const images = Array.from(container.querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/v1/content/files/portrait.png",
      sameOrigin,
    ]);
    expect(images.map((image) => image.alt)).toEqual(["portrait", "included"]);
  });
});

describe("markdown replies", () => {
  it("show raw HTML as text instead of elements", () => {
    const container = chatReply(
      "<details><summary>More</summary>Hidden</details>\n\nH<sub>2</sub>O",
    );
    expect(container.querySelector("details, summary, sub")).toBeNull();
    expect(container.textContent).toContain(
      "<details><summary>More</summary>Hidden</details>",
    );
    expect(container.textContent).toContain("H<sub>2</sub>O");
  });

  it("open a link only after a dialog shows its destination", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const container = chatReply(
      "Read [the guide](https://site.example/guide).",
    );
    expect(container.querySelector("a[href]")).toBeNull();
    const link = container.querySelector<HTMLButtonElement>(
      'button[data-streamdown="link"]',
    );
    expect(link?.textContent).toBe("the guide");
    act(() => link!.click());
    const dialog = document.querySelector(
      '[data-streamdown="link-safety-modal"]',
    );
    expect(dialog?.textContent).toContain("https://site.example/guide");
    expect(open).not.toHaveBeenCalled();
  });

  it("keep their image, HTML and link rules whatever a caller passes", () => {
    const container = mount(
      <Response
        components={{ img: "img" }}
        rehypePlugins={Object.values(defaultRehypePlugins)}
        linkSafety={{ enabled: false }}
      >
        {
          "![chart](https://images.example/chart.png) H<sub>2</sub>O [guide](https://site.example/)"
        }
      </Response>,
    );
    expect(loadedSources(container)).toEqual([]);
    expect(container.textContent).toContain("[Image: chart]");
    expect(container.querySelector("sub")).toBeNull();
    expect(container.querySelector("a[href]")).toBeNull();
  });
});
