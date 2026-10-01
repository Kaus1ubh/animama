import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RuntimeFeatureGate,
  useRuntimeFeatureEnabled,
} from "@/ui/app/RuntimeFeatureGate";

const fixture = vi.hoisted(() => ({
  query: { data: undefined as Record<string, unknown> | undefined },
}));

vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => fixture.query,
}));

function Probe() {
  return <>{String(useRuntimeFeatureEnabled("chat_file_uploads"))}</>;
}

function render() {
  return renderToStaticMarkup(
    <>
      <Probe />
      <RuntimeFeatureGate capability="anima_creation">
        <a href="/animas/new">Create Anima</a>
      </RuntimeFeatureGate>
    </>,
  );
}

describe("runtime feature gate", () => {
  beforeEach(() => {
    fixture.query = { data: undefined };
  });

  it("keeps entry points while capabilities are loading or unreadable", () => {
    expect(render()).toBe('true<a href="/animas/new">Create Anima</a>');
  });

  it("hides only the capability the backend reports disabled", () => {
    fixture.query = {
      data: { chat_file_uploads: true, anima_creation: false },
    };
    expect(render()).toBe("true");
    fixture.query = {
      data: { chat_file_uploads: false, anima_creation: true },
    };
    expect(render()).toBe('false<a href="/animas/new">Create Anima</a>');
  });
});
