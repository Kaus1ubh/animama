import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmotionDetails, EmotionSummary } from "./emotional-state";

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
    expect(html).toContain("No active emotions.");
    expect(html).not.toContain("width:");
  });
});

describe("EmotionDetails", () => {
  it("shows a concise neutral state without repeated legends or diagnostic labels", () => {
    const html = renderToStaticMarkup(
      <EmotionDetails
        emotionalState={{}}
        showSummary={false}
        sourceLabel="Live runtime state"
      />,
    );
    expect(html).toContain("No active emotions.");
    expect(html).not.toMatch(
      /Live runtime state|Group averages|Affection|<button|<svg/,
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
    expect(html).toContain("each showing its strongest emotion");
    expect(html).not.toContain("Hover or select an emotion");
    expect(html).not.toMatch(
      /Persisted anima state|Group averages|Emotion group details|rounded-xl border/,
    );
  });
});
