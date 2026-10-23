// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmotionDetails, EmotionSummary } from "./emotional-state";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("EmotionSummary", () => {
  it("renders three labeled proportional bars without numeric score copy", () => {
    const html = renderToStaticMarkup(
      <EmotionSummary
        emotionalState={{ love: 30, respect: 18, joy: 9, fear: 3 }}
      />,
    );
    expect(html).toContain("Feeling very loving");
    expect(html).toContain("Affection");
    expect(html).toContain("Esteem");
    expect(html).toContain("Delight");
    expect(html).not.toContain("Alarm");
    expect(html.match(/width:/g)).toHaveLength(3);
    expect(html).toContain("width:20%");
    expect(html).toContain("width:10%");
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/[0-9]/);
  });
  it("renders neutral without bars or numeric diagnostics", () => {
    const html = renderToStaticMarkup(<EmotionSummary emotionalState={{}} />);
    expect(html).toContain("Feeling neutral");
    expect(html).not.toContain("No active emotions.");
    expect(html).not.toContain("width:");
  });
});

describe("EmotionDetails", () => {
  it("keeps the neutral bloom without empty-state copy or diagnostics", () => {
    const html = renderToStaticMarkup(
      <EmotionDetails
        emotionalState={{}}
        showSummary={false}
        sourceLabel="Live runtime state"
      />,
    );
    expect(html).not.toContain("No active emotions.");
    expect(html).toContain("Emotion bloom: 24 emotions in eight groups");
    expect(html).not.toMatch(
      /Live runtime state|Group averages|No active emotions/,
    );
  });
  it("reserves interaction details outside the plot without a persistent detail card", () => {
    const html = renderToStaticMarkup(
      <EmotionDetails
        emotionalState={{ joy: 24 }}
        showSummary={false}
        sourceLabel="Persisted anima state"
      />,
    );
    expect(html).toContain("Emotion bloom: 24 emotions in eight groups");
    expect(html).not.toContain("Hover or select an emotion");
    expect(html).not.toMatch(
      /Persisted anima state|Group averages|Emotion group details|rounded-xl border/,
    );
  });
  it("shows a group's emotions when it is chosen from the keyboard", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EmotionDetails
          emotionalState={{ joy: 24, amusement: 6 }}
          showSummary={false}
        />,
      );
    });
    const delight = container.querySelector<SVGElement>(
      '[data-emotion-group="delight"]',
    )!;
    const caption = document.getElementById(
      delight.getAttribute("aria-describedby")!,
    )!;
    expect(caption.textContent).toBe("");
    await act(async () => {
      delight.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(delight.dataset.selected).toBe("true");
    expect(caption.textContent).toContain("Delight");
    expect(caption.textContent).toContain("Joy24");
    expect(caption.textContent).toContain("Amusement6");
    // Tabbing on to the next group keeps the caption until that group takes it.
    await act(async () => {
      delight.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: container.querySelector(
            '[data-emotion-group="drive"]',
          ),
        }),
      );
    });
    expect(caption.textContent).toContain("Delight");
    await act(async () => {
      delight.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(caption.textContent).toBe("");
    await act(async () => root.unmount());
    container.remove();
  });

  it("singles out the petal under the pointer in the caption", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EmotionDetails
          emotionalState={{ joy: 24, amusement: 6 }}
          showSummary={false}
        />,
      );
    });
    const delight = container.querySelector<SVGElement>(
      '[data-emotion-group="delight"]',
    )!;
    const caption = document.getElementById(
      delight.getAttribute("aria-describedby")!,
    )!;
    // happy-dom lays the bloom out at the origin, so this points just
    // clockwise of Delight's centre (90°), at Joy's petal.
    await act(async () => {
      delight.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 10, clientY: 2, bubbles: true }),
      );
    });
    expect(caption.textContent).toContain("Delight");
    expect(caption.querySelector('[data-pointed="true"]')?.textContent).toBe(
      "Joy24",
    );
    await act(async () => {
      delight.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 10,
          clientY: -2,
          bubbles: true,
        }),
      );
    });
    expect(caption.querySelector('[data-pointed="true"]')?.textContent).toBe(
      "Amusement6",
    );
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a tapped group until a tap elsewhere", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EmotionDetails emotionalState={{ fear: 12 }} showSummary={false} />,
      );
    });
    const alarm = container.querySelector<SVGElement>(
      '[data-emotion-group="alarm"]',
    )!;
    const caption = document.getElementById(
      alarm.getAttribute("aria-describedby")!,
    )!;
    await act(async () => {
      alarm.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerType: "touch",
          bubbles: true,
        }),
      );
      alarm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(caption.textContent).toContain("Fear12");
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerType: "touch",
          bubbles: true,
        }),
      );
    });
    expect(caption.textContent).toBe("");
    await act(async () => root.unmount());
    container.remove();
  });
});
