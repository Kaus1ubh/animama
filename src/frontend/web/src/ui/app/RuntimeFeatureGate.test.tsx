import { renderToStaticMarkup } from "@/test/runtime-markup";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedExclusionReasons } from "@/app/runtime/route-admission";
import {
  RuntimeFeatureGate,
  useRuntimeFeatureEnabled,
  useRuntimeFeatureUnavailableReason,
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

function ReasonProbe() {
  return <>{useRuntimeFeatureUnavailableReason("chat_file_uploads") ?? ""}</>;
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

function renderWithFallback() {
  return renderToStaticMarkup(
    <RuntimeFeatureGate
      capability="anima_creation"
      unavailable={(reason) => <button disabled>{reason}</button>}
    >
      <a href="/animas/new">Create Anima</a>
    </RuntimeFeatureGate>,
  );
}

describe("runtime feature gate", () => {
  beforeEach(() => {
    fixture.query = { data: undefined };
  });

  it("withholds entry points while capabilities are loading or unreadable", () => {
    expect(render()).toBe("false");
    expect(renderToStaticMarkup(<ReasonProbe />)).toBe("");
    expect(renderWithFallback()).toBe("");
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

  it("explains an explicitly withheld feature with its shared exclusion reason", () => {
    fixture.query = {
      data: { chat_file_uploads: false, anima_creation: false },
    };
    expect(renderToStaticMarkup(<ReasonProbe />)).toBe(
      hostedExclusionReasons.chat_file_uploads,
    );
    expect(renderWithFallback()).toBe(
      `<button disabled="">${hostedExclusionReasons.anima_creation}</button>`,
    );
  });

  it("keeps an offered feature's entry point instead of the explanation", () => {
    fixture.query = {
      data: { chat_file_uploads: true, anima_creation: true },
    };
    expect(renderToStaticMarkup(<ReasonProbe />)).toBe("");
    expect(renderWithFallback()).toBe('<a href="/animas/new">Create Anima</a>');
  });
});
