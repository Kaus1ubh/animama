import { describe, expect, it, vi } from "vitest";

import type { PreviewRuntimeCatalogDelegate } from "./PreviewRuntimeCatalogSession";
import { PreviewRuntimeCatalogSession } from "./PreviewRuntimeCatalogSession";

function delegate(revision: string) {
  return {
    revision,
    dispose: vi.fn(),
  } as unknown as PreviewRuntimeCatalogDelegate;
}

describe("PreviewRuntimeCatalogSession", () => {
  it("atomically replaces and disposes only the previous delegate", () => {
    const session = new PreviewRuntimeCatalogSession();
    const first = delegate("first");
    const second = delegate("second");
    session.replace(first);
    expect(session.revision).toBe("first");
    session.replace(second);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(session.revision).toBe("second");
    session.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});
