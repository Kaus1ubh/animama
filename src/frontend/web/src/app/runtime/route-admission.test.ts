import { afterEach, describe, expect, it, vi } from "vitest";
import { hostedCapabilitiesFixture } from "./runtime-fixture";
import {
  unavailableReasonText,
  unavailableRouteReason,
} from "./route-admission";
import { Route as PipRoute } from "@/routes/desktop/pip/$animaId";
import { Route as QuickChatRoute } from "@/routes/desktop/quick-chat/$animaId";

describe("native auxiliary route admission", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    [PipRoute, "pip", "pip"],
    [QuickChatRoute, "quick-chat", "quickChat"],
  ] as const)(
    "preserves the native child route's exact preload role and bridge check (%s)",
    (route, role, member) => {
      const admit = () => {
        const guard = route.options.beforeLoad;
        if (typeof guard === "function") return guard({} as never);
      };
      for (const bridge of [
        undefined,
        { isDesktop: false, windowRole: role, [member]: {} },
        { isDesktop: true, windowRole: "main", [member]: {} },
        { isDesktop: true, windowRole: role },
      ]) {
        vi.stubGlobal("window", { animamaDesktop: bridge });
        expect(admit).toThrow();
      }
      vi.stubGlobal("window", {
        animamaDesktop: { isDesktop: true, windowRole: role, [member]: {} },
      });
      expect(admit).not.toThrow();
    },
  );
  it.each(["/desktop/pip/fixture", "/desktop/quick-chat/fixture"])(
    "lets local %s reach its renderer bridge guard with Compose-shaped capabilities",
    (path) => {
      expect(
        unavailableRouteReason(path, {
          ...hostedCapabilitiesFixture,
          runtime_kind: "self_hosted_web",
          native_features: false,
        }),
      ).toBeNull();
    },
  );
  it.each(["/desktop/pip/fixture", "/desktop/quick-chat/fixture"])(
    "keeps hosted %s excluded",
    (path) => {
      const reason = unavailableRouteReason(path, hostedCapabilitiesFixture);
      expect(reason).toBe("native_features");
      expect(unavailableReasonText(reason!)).toContain("desktop application");
    },
  );
});
