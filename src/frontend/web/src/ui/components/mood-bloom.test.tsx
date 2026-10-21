import { useReducedMotion } from "motion/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoodBloom, type MoodBloomSelection } from "./mood-bloom";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: vi.fn(() => null),
}));

afterEach(() => {
  vi.mocked(useReducedMotion).mockReturnValue(null);
});

const pollen = /attributeName="cy"/;
const selection: MoodBloomSelection = {
  group: null,
  onSelect: () => {},
  onBlur: () => {},
  onClearPointer: () => {},
};

describe("MoodBloom", () => {
  it("draws all 24 emotions as petals", () => {
    const html = renderToStaticMarkup(<MoodBloom emotionalState={{}} />);
    expect(html.match(/data-bloom-petal=/g)).toHaveLength(24);
  });

  it("rests on the neutral mascot with no pollen or tip symbols at all-zero", () => {
    const html = renderToStaticMarkup(<MoodBloom emotionalState={{}} />);
    expect(html).toContain("emotions/neutral.webp");
    expect(html).toContain('aria-label="Feeling neutral"');
    expect(html).not.toMatch(pollen);
    expect(html).not.toContain("data-bloom-tip=");
  });

  it("sheds pollen only once the strongest emotion reaches 3", () => {
    expect(
      renderToStaticMarkup(
        <MoodBloom emotionalState={{ joy: 2, caring: 1 }} />,
      ),
    ).not.toMatch(pollen);
    expect(
      renderToStaticMarkup(<MoodBloom emotionalState={{ joy: 3 }} />),
    ).toMatch(pollen);
  });

  it("marks the strongest groups with tip symbols", () => {
    const html = renderToStaticMarkup(
      <MoodBloom emotionalState={{ joy: 24, love: 12, fear: 6, grief: 2 }} />,
    );
    expect(html.match(/data-bloom-tip="[a-z]+"/g)).toEqual([
      'data-bloom-tip="delight"',
      'data-bloom-tip="affection"',
      'data-bloom-tip="alarm"',
    ]);
  });

  it("offers each emotion group as a labelled button when selectable", () => {
    const html = renderToStaticMarkup(
      <MoodBloom
        emotionalState={{ joy: 24, amusement: 6 }}
        selection={{ ...selection, describedBy: "bloom-detail" }}
      />,
    );
    expect(html).toContain(
      'aria-label="Emotion bloom: 24 emotions in eight groups"',
    );
    expect(html.match(/role="button"/g)).toHaveLength(8);
    expect(html.match(/tabindex="0"/g)).toHaveLength(8);
    expect(html).toContain(
      'aria-label="Delight: 24. Amusement 6, Excitement 0, and Joy 24"',
    );
    expect(html).toContain('aria-describedby="bloom-detail"');
  });

  it("highlights the selected group", () => {
    const html = renderToStaticMarkup(
      <MoodBloom
        emotionalState={{ joy: 24 }}
        selection={{ ...selection, group: "delight" }}
      />,
    );
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(
      /data-emotion-group="delight"[^>]*data-selected="true"/,
    );
  });

  it("holds still for reduced motion", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const html = renderToStaticMarkup(
      <MoodBloom emotionalState={{ joy: 24 }} />,
    );
    expect(html).not.toMatch(/<animate/);
    expect(html).not.toContain("scale(0.12)");
    expect(html.match(/data-bloom-petal=/g)).toHaveLength(24);
  });
});
