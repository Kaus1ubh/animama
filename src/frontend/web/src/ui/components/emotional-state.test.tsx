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
    expect(html).toContain("Feeling loving");
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
  it("can omit the repeated summary while retaining accessible group details", () => {
    const html = renderToStaticMarkup(
      <EmotionDetails emotionalState={{}} showSummary={false} />,
    );
    expect(html).not.toContain("Feeling neutral");
    expect(html).toContain("Group averages · scale 0–30");
    expect(html).toContain("Affection");
    expect(html.match(/<button/g)).toHaveLength(8);
  });
});
