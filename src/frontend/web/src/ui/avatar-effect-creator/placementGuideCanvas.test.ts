import { Object3D, OrthographicCamera } from "three";
import { describe, expect, it } from "vitest";
import { projectPlacementGuidePoint } from "./placementGuideCanvas";

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
});
