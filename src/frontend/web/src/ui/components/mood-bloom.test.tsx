import { useReducedMotion } from "motion/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MoodBloom,
  emotionAtAngle,
  type MoodBloomSelection,
} from "./mood-bloom";

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

  it("rests on the neutral mascot with no pollen or emphasised group at all-zero", () => {
    const html = renderToStaticMarkup(<MoodBloom emotionalState={{}} />);
    expect(html).toContain("emotions/neutral.webp");
    expect(html).toContain('aria-label="Feeling neutral"');
    expect(html).not.toMatch(pollen);
    expect(html.match(/data-bloom-rim=/g)).toHaveLength(8);
    expect(html).not.toContain('data-strong="true"');
  });

  it("names every group around the rim", () => {
    const html = renderToStaticMarkup(<MoodBloom emotionalState={{}} />);
    for (const name of [
      "Affection",
      "Esteem",
      "Delight",
      "Drive",
      "Alarm",
      "Rejection",
      "Revulsion",
      "Gloom",
    ])
      expect(html).toMatch(
        new RegExp(`data-bloom-name="[a-z]+"[^>]*>${name}<`),
      );
  });

  it("draws reference rings at 10, 20 and 30", () => {
    const html = renderToStaticMarkup(<MoodBloom emotionalState={{}} />);
    expect(html.match(/data-bloom-ring="(\d+)"/g)).toEqual([
      'data-bloom-ring="10"',
      'data-bloom-ring="20"',
      'data-bloom-ring="30"',
    ]);
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

  it("emphasises the three strongest groups", () => {
    const html = renderToStaticMarkup(
      <MoodBloom emotionalState={{ joy: 24, love: 12, fear: 6, grief: 2 }} />,
    );
    expect(html.match(/data-bloom-rim="[a-z]+" data-strong="true"/g)).toEqual([
      'data-bloom-rim="affection" data-strong="true"',
      'data-bloom-rim="delight" data-strong="true"',
      'data-bloom-rim="alarm" data-strong="true"',
    ]);
  });

  it("finds the petal nearest an angle within its group", () => {
    // Delight's slot is centred at 90°: amusement, excitement, joy clockwise.
    expect(emotionAtAngle("delight", 90)).toBe("excitement");
    expect(emotionAtAngle("delight", 80)).toBe("amusement");
    expect(emotionAtAngle("delight", 110)).toBe("joy");
    // Affection straddles the top: admiration lies just left of it.
    expect(emotionAtAngle("affection", 350)).toBe("admiration");
    expect(emotionAtAngle("affection", 20)).toBe("love");
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
    expect(html).toContain('data-bloom-highlight="delight"');
    // Its three petals grow; the other groups' 21 fade.
    expect(html.match(/transform:scale\(1\.08\)/g)).toHaveLength(3);
    expect(html.match(/opacity="0.15"/g)).toHaveLength(21);
  });

  it("names the pointed petal and its score in place of its group", () => {
    const html = renderToStaticMarkup(
      <MoodBloom
        emotionalState={{ joy: 24, amusement: 6 }}
        selection={{ ...selection, group: "delight", emotion: "joy" }}
      />,
    );
    expect(html).toMatch(
      /data-bloom-name="delight"[^>]*>Joy <tspan[^>]*>24<\/tspan>/,
    );
    // Its siblings dim a little.
    expect(html.match(/opacity="0.55"/g)).toHaveLength(2);
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
