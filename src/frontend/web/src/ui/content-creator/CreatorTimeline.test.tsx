import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { timelinePointerTime } from "@/ui/action-editor/timelineCatalogDrop";
import {
  CreatorTimelineLane,
  CreatorTimelinePlayhead,
  CreatorTimelineRuler,
  CreatorTimelineTransport,
} from "./CreatorTimeline";
import {
  getTimelineLeftStyle,
  getTimelinePercent,
  TRACK_LABEL_RAIL_PX,
  TRACK_RIGHT_INSET_PX,
} from "./creatorTimelineGeometry";

const transport = {
  playing: false,
  onTogglePlayback: () => {},
  onStop: () => {},
  onRestart: () => {},
};

describe("shared creator timeline", () => {
  it("keeps pending Play and Restart disabled while Stop remains available", () => {
    const html = renderToString(
      <CreatorTimelineTransport {...transport} pending />,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Play clip preview"/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Restart clip preview"/,
    );
    const stop = html.match(
      /<button[^>]*aria-label="Stop clip preview"[^>]*>/,
    )?.[0];
    expect(stop).toBeDefined();
    expect(stop).not.toContain('disabled=""');
    expect(html).toContain('title="Loading preview resources"');
  });

  it("shares lane and playhead coordinates with the existing scrub/drop interval", () => {
    const rect = { left: 20, top: 0, width: 688, height: 176 };
    for (const ratio of [0, 0.25, 0.5, 1]) {
      const clientX =
        rect.left +
        TRACK_LABEL_RAIL_PX +
        ratio * (rect.width - TRACK_LABEL_RAIL_PX - TRACK_RIGHT_INSET_PX);
      const time = timelinePointerTime(clientX, rect, 4);
      expect(time).toBe(ratio * 4);
      expect(getTimelinePercent(time, 4)).toBe(ratio * 100);
      expect(getTimelineLeftStyle(ratio * 100)).toBe(
        `calc(72px + (100% - 88px) * ${ratio})`,
      );
    }
    const html = renderToString(
      <CreatorTimelineLane
        index={2}
        label="Head sparkles"
        selected
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("top:88px;height:28px");
    expect(html).toContain('aria-label="Head sparkles"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("suppresses repeated playhead time and allows drop labels to hide ruler text", () => {
    const repeated = renderToString(
      <CreatorTimelinePlayhead timeSec={1} durationSec={4} />,
    );
    expect(repeated).not.toContain('aria-label="Current playhead time"');
    const distinct = renderToString(
      <CreatorTimelinePlayhead timeSec={1.1} durationSec={4} />,
    );
    expect(distinct).toContain('aria-label="Current playhead time"');
    expect(distinct).toContain("1.10s");
    const hidden = renderToString(
      <CreatorTimelinePlayhead timeSec={1.1} durationSec={4} hideLabel />,
    );
    expect(hidden).not.toContain('aria-label="Current playhead time"');
    const ruler = renderToString(
      <CreatorTimelineRuler durationSec={4} hideTick={(time) => time === 1} />,
    );
    expect(ruler).toMatch(/class="[^"]*invisible[^"]*">1.00s/);
  });
});
