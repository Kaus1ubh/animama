import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SafetySettingsSection } from "@/ui/settings/SafetySettingsSection";

const fixture = vi.hoisted(() => ({
  capability: {
    enabled: true,
    ai_notice_enabled: true,
    crisis_detection_enabled: true,
    operator_reminder_hours: 3,
  },
}));

vi.mock("@/app/runtime/RuntimeOwnerContext", () => ({
  useRuntimeOwnerId: () => "owner-1",
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    data: { companion_safety: fixture.capability },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      regions: [
        { code: "US", label: "United States" },
        { code: "GB", label: "United Kingdom" },
      ],
      preferred_region: null,
      resolved: { code: "US", label: "United States" },
    },
    refetch: vi.fn(),
  }),
}));

function render(safety = {}) {
  return renderToStaticMarkup(
    <SafetySettingsSection safety={safety} updateUserPreferences={vi.fn()} />,
  );
}

describe("Safety settings", () => {
  beforeEach(() => {
    fixture.capability = {
      enabled: true,
      ai_notice_enabled: true,
      crisis_detection_enabled: true,
      operator_reminder_hours: 3,
    };
  });

  it("offers region, a shorter reminder and the protocol, but no off switch", () => {
    const html = render();
    expect(html).toContain("Crisis resources region");
    expect(html).toContain("AI reminder during long conversations");
    expect(html).toContain("Safety and crisis protocol");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("<input");
  });

  it("hides the reminder choice when the operator turned the notice off", () => {
    fixture.capability = { ...fixture.capability, ai_notice_enabled: false };
    expect(render()).not.toContain("AI reminder during long conversations");
  });

  it("explains an operator-disabled installation and keeps only the protocol", () => {
    fixture.capability = { ...fixture.capability, enabled: false };
    const html = render();
    expect(html).toContain("has turned off the AI notice and crisis support");
    expect(html).not.toContain("Crisis resources region");
    expect(html).toContain("Safety and crisis protocol");
  });
});
