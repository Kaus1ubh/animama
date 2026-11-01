import type * as THREE from "three";

type HiddenGeometry = {
  index: THREE.BufferAttribute;
  /** Each triangle ever hidden, with its original corners. */
  original: Map<number, [number, number, number]>;
  /** Triangles each source wants hidden. */
  sources: Map<string, Set<number>>;
};

/**
 * Hides triangle regions of a primitive that also draws other parts, such as
 * lash strands inside the face mesh, while any source (an active effect) asks
 * for them. Hidden triangles are rewritten in place as degenerate triangles
 * (all three corners on one vertex), so nothing is drawn for them, MToon
 * outlines drawing the same index stay consistent, and the index buffer is
 * updated rather than replaced. Releasing the last source restores them.
 */
export class PrimitiveRegionHider {
  private readonly _geometries = new Map<
    THREE.BufferGeometry,
    HiddenGeometry
  >();

  /**
   * Hide `triangles` (numbers in the geometry's index buffer) for `sourceId`.
   * Returns false when the geometry has no index, so the region cannot be
   * hidden this way.
   */
  hide(
    sourceId: string,
    geometry: THREE.BufferGeometry,
    triangles: readonly number[],
  ): boolean {
    let state = this._geometries.get(geometry);
    if (!state) {
      const index = geometry.getIndex();
      if (!index) return false;
      state = { index, original: new Map(), sources: new Map() };
      this._geometries.set(geometry, state);
    }
    const wanted = state.sources.get(sourceId) ?? new Set<number>();
    const triangleCount = Math.floor(state.index.count / 3);
    for (const triangle of triangles) {
      if (triangle < 0 || triangle >= triangleCount) continue;
      wanted.add(triangle);
      if (!state.original.has(triangle)) {
        const at = triangle * 3;
        state.original.set(triangle, [
          state.index.getX(at),
          state.index.getX(at + 1),
          state.index.getX(at + 2),
        ]);
      }
    }
    state.sources.set(sourceId, wanted);
    write(state);
    return true;
  }

  /** Drop everything `sourceId` hid; regions no other source hides reappear. */
  release(sourceId: string): void {
    for (const [geometry, state] of this._geometries) {
      if (!state.sources.delete(sourceId)) continue;
      write(state);
      if (state.sources.size === 0) this._geometries.delete(geometry);
    }
  }

  /**
   * Run `read` with every hidden triangle drawn as it was, then hide them
   * again: for measuring a primitive as it is rather than as active effects
   * leave it (the face skin's clip, which is cached).
   */
  withRegionsShown<T>(read: () => T): T {
    for (const state of this._geometries.values()) write(state, new Set());
    try {
      return read();
    } finally {
      for (const state of this._geometries.values()) write(state);
    }
  }

  /** Restore every hidden triangle, as before a rebuild or disposal. */
  restoreAll(): void {
    for (const state of this._geometries.values()) {
      state.sources.clear();
      write(state);
    }
    this._geometries.clear();
  }
}

/**
 * Write each touched triangle as hidden (degenerate) or as it was: hidden
 * when any source hides it, unless `hidden` names the set to write instead.
 */
function write(state: HiddenGeometry, hidden = hiddenBySources(state)): void {
  for (const [triangle, [a, b, c]] of state.original) {
    const at = triangle * 3;
    if (hidden.has(triangle)) {
      state.index.setX(at, a);
      state.index.setX(at + 1, a);
      state.index.setX(at + 2, a);
    } else {
      state.index.setX(at, a);
      state.index.setX(at + 1, b);
      state.index.setX(at + 2, c);
    }
  }
  state.index.needsUpdate = true;
}

/** Every triangle some source hides. */
function hiddenBySources(state: HiddenGeometry): Set<number> {
  const hidden = new Set<number>();
  for (const triangles of state.sources.values()) {
    for (const triangle of triangles) hidden.add(triangle);
  }
  return hidden;
}
