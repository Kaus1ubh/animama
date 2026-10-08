import { Object3D, OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";
import {
  drawPlacementGuides,
  projectPlacementGuidePoint,
} from "./placementGuideCanvas";

describe("placement guide projection", () => {
  it("follows the live head transform and camera without cached world coordinates", () => {
    const head = new Object3D();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    camera.updateMatrixWorld();
    const point = { x: 0.25, y: 0.5, z: 0 };
    expect(projectPlacementGuidePoint(point, head, camera, 200, 200)).toEqual({
      x: 125,
      y: 50,
    });
    head.position.x = 0.5;
    expect(projectPlacementGuidePoint(point, head, camera, 200, 200)).toEqual({
      x: 175,
      y: 50,
    });
    camera.position.x = 0.5;
    camera.updateMatrixWorld();
    expect(projectPlacementGuidePoint(point, head, camera, 200, 200)).toEqual({
      x: 125,
      y: 50,
    });
  });

  it("does not put markers for points outside the camera depth range on the screen", () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    camera.updateMatrixWorld();
    expect(
      projectPlacementGuidePoint(
        { x: 0, y: 0, z: 3 },
        new Object3D(),
        camera,
        200,
        200,
      ),
    ).toBeNull();
    expect(
      projectPlacementGuidePoint(
        { x: Number.NaN, y: 0, z: 0 },
        new Object3D(),
        camera,
        200,
        200,
      ),
    ).toBeNull();
  });

  it("puts each guide label below its point and its art, clear of the rotate handle", () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;
    camera.updateMatrixWorld();
    const labels: Array<{ text: string; y: number }> = [];
    const rects: Array<{ y: number; height: number }> = [];
    const context = {
      setTransform: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      setLineDash: () => {},
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillRect: (_x: number, y: number, _w: number, height: number) =>
        rects.push({ y, height }),
      fillText: (text: string, _x: number, y: number) =>
        labels.push({ text, y }),
    };
    const canvas = {
      width: 0,
      height: 0,
      dataset: {} as Record<string, string>,
      getAttribute: () => null,
      setAttribute: () => {},
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const guide = (label: string, halfHeight: number) => ({
      label,
      reference: { x: 0, y: 0, z: 0 },
      source: "geometric" as const,
      artwork: [
        { x: -0.1, y: halfHeight, z: 0 },
        { x: 0.1, y: halfHeight, z: 0 },
        { x: 0.1, y: -halfHeight, z: 0 },
        { x: -0.1, y: -halfHeight, z: 0 },
      ],
    });
    for (const [label, halfHeight] of [
      ["Eye right", 0.02],
      ["Top edge", 0.4],
    ] as const) {
      labels.length = 0;
      rects.length = 0;
      drawPlacementGuides(
        canvas,
        {
          anchor: new Object3D(),
          faceBounds: null,
          spatial: [guide(label, halfHeight)],
          surfaces: [],
          messages: [],
          active: true,
        },
        camera,
        200,
        200,
        1,
      );
      // The reference point projects to y = 100; the art spans ± halfHeight.
      const artBottom = 100 + halfHeight * 100;
      const labelRect = rects.at(-1)!;
      expect(labels.at(-1)?.text).toBe(label);
      expect(labelRect.y).toBeGreaterThanOrEqual(artBottom + 10);
      expect(labelRect.y).toBeGreaterThanOrEqual(100 + 20);
    }
  });
});
