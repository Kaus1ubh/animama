import { describe, expect, it } from "vitest";

import { idleStyleSpec, type IdleStyleDocument } from "./idleStyleDocument";

const breathing = "local:gesture:breathing";
const wave = "included:gesture:wave";

describe("idleStyleSpec", () => {
  it("keeps intensity pools distinct and includes each required Gesture once", () => {
    const document: IdleStyleDocument = {
      defaultPool: [breathing],
      cells: {
        joy: {
          "1": { mode: "pool", gestures: [wave, breathing] },
          "3": { mode: "none" },
        },
      },
    };
    expect(idleStyleSpec(document)).toEqual({
      schema_version: 2,
      default_pool: [breathing],
      cells: document.cells,
      dependencies: [
        { kind: "gesture", ref: breathing },
        { kind: "gesture", ref: wave },
      ],
      compatibility: { vrm_versions: ["0.x", "1.0"] },
    });
  });

  it("accepts an empty Default and preserves No idle without inventing inherited cells", () => {
    const spec = idleStyleSpec({
      defaultPool: [],
      cells: { sadness: { "2": { mode: "none" } } },
    });
    expect(spec.default_pool).toEqual([]);
    expect(spec.dependencies).toEqual([]);
    expect(spec.cells).toEqual({ sadness: { "2": { mode: "none" } } });
    expect(spec).not.toHaveProperty("animations");
    expect(spec).not.toHaveProperty("cross_fade_seconds");
  });

  it("rejects repeated Gesture refs and empty explicit pools", () => {
    expect(() =>
      idleStyleSpec({ defaultPool: [wave, wave], cells: {} }),
    ).toThrow("unique");
    expect(() =>
      idleStyleSpec({
        defaultPool: [],
        cells: { joy: { "1": { mode: "pool", gestures: [] } } },
      }),
    ).toThrow("at least one Gesture");
    expect(() => idleStyleSpec({ defaultPool: [""], cells: {} })).toThrow(
      "Gesture reference",
    );
  });
});
