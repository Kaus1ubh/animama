import { describe, expect, it } from "vitest";

import { presentIdleStyle } from "./idleStylePresentation";

describe("presentIdleStyle", () => {
  it("distinguishes each intensity, inherited Default and explicit No idle", () => {
    const rows = presentIdleStyle({
      state: "custom",
      schema_version: 2,
      gestures: [
        {
          item_id: "breathing",
          logical_key: "local:gesture:breathing",
          name: "Breathing",
        },
        { item_id: "wave", logical_key: "included:gesture:wave", name: "Wave" },
      ],
      default_pool: ["local:gesture:breathing"],
      cells: {
        joy: {
          "1": { mode: "pool", gestures: ["included:gesture:wave"] },
          "3": { mode: "none" },
        },
      },
    });
    expect(rows.find((row) => row.key === "default")?.gestureNames).toEqual([
      "Breathing",
    ]);
    expect(rows.find((row) => row.key === "joy:1")).toMatchObject({
      gestureRefs: ["included:gesture:wave"],
      gestureNames: ["Wave"],
      mode: "pool",
    });
    expect(rows.find((row) => row.key === "joy:2")).toMatchObject({
      gestureNames: ["Breathing"],
      mode: "inherit",
    });
    expect(rows.find((row) => row.key === "joy:3")).toMatchObject({
      gestureRefs: [],
      mode: "none",
    });
    expect(rows.filter((row) => row.key.startsWith("joy:"))).toHaveLength(3);
  });

  it("shows an empty Default without inventing a Gesture or an assignment for no Style", () => {
    const rows = presentIdleStyle({
      state: "custom",
      default_pool: [],
      cells: {},
      gestures: [],
    });
    expect(rows[0]?.gestureRefs).toEqual([]);
    expect(presentIdleStyle({ state: "empty" })).toEqual([]);
  });
});
