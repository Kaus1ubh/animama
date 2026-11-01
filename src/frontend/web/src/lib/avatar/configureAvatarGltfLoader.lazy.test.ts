import { describe, expect, it, vi } from "vitest";

import { createAvatarGltfLoader } from "./avatarGltfLoader";
import { encodeGlb } from "./testing/glb";
import { meshoptTriangleGlb } from "./testing/meshoptGlb";

const decoderModule = vi.hoisted(() => ({ loads: 0 }));

// Counts evaluations: the module compiles its WebAssembly when evaluated.
vi.mock(
  "three/examples/jsm/libs/meshopt_decoder.module.js",
  async (importOriginal) => {
    decoderModule.loads += 1;
    return importOriginal();
  },
);

describe("configureAvatarGltfLoader's meshopt decoder", () => {
  it("is imported only for a file that uses meshopt", async () => {
    const plain = encodeGlb({
      asset: { version: "2.0" },
      scenes: [{ nodes: [] }],
    }).buffer as ArrayBuffer;
    await createAvatarGltfLoader().parseAsync(plain, "");
    expect(decoderModule.loads).toBe(0);

    await createAvatarGltfLoader().parseAsync(meshoptTriangleGlb(), "");
    await createAvatarGltfLoader().parseAsync(meshoptTriangleGlb(), "");
    expect(decoderModule.loads).toBe(1);
  });
});
