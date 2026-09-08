import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlaybackObservationOutput } from "./PlaybackObservationOutput";

describe("PlaybackObservationOutput", () => {
  it("renders exactly one hidden, versioned, escaped observation", () => {
    const html = renderToStaticMarkup(
      <PlaybackObservationOutput
        active={false}
        avatar={null}
        sceneVFX={null}
        status="stopped"
        surface="library-dock"
        target={{ kind: "scene_vfx", runtimeId: "chaos-</output><script>" }}
      />,
    );

    expect(html.match(/data-playback-observation/g)).toHaveLength(1);
    expect(html).toContain('<output hidden=""');
    expect(html).toContain('data-schema-version="1"');
    expect(html).toContain("&quot;version&quot;:1");
    expect(html).toContain("chaos-&lt;/output&gt;&lt;script&gt;");
    expect(html).not.toContain("</output><script>");
  });

  it("renders the shared creator surface with an existing runtime target", () => {
    const html = renderToStaticMarkup(
      <PlaybackObservationOutput
        active
        avatar={null}
        expressionNames={["happy"]}
        poseClipSample={{
          runtimeId: "new-reaction",
          active: false,
          playheadSec: 0,
          durationSec: 1.2,
        }}
        sceneVFX={null}
        status="stopped"
        surface="creator-stage"
        target={{ kind: "anima_pose_clip", runtimeId: "new-reaction" }}
      />,
    );

    expect(html.match(/data-playback-observation/g)).toHaveLength(1);
    expect(html).toContain("&quot;surface&quot;:&quot;creator-stage&quot;");
    expect(html).toContain("&quot;kind&quot;:&quot;anima_pose_clip&quot;");
    expect(html).toContain("&quot;runtimeId&quot;:&quot;new-reaction&quot;");
    // No Avatar means no applied expression, even when the timeline exists.
    expect(html).toContain("&quot;happy&quot;:0");
  });
});
