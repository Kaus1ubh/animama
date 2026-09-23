import { describe, expect, it, vi } from "vitest";
import { Route as NewRoute } from "@/routes/a/sound-effects.new";
import { Route as EditRoute } from "@/routes/a/sound-effects.$soundEffectId.edit";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: (options: unknown) => options,
}));

describe("legacy sound bookmarks", () => {
  it.each([NewRoute, EditRoute])(
    "redirects to the Sounds Library without opening a creator",
    (route) => {
      const options = route as unknown as {
        beforeLoad: () => never;
        component?: unknown;
      };
      expect(options.component).toBeUndefined();
      let redirect: unknown;
      try {
        options.beforeLoad();
      } catch (value) {
        redirect = value;
      }
      expect(redirect).toEqual({
        to: "/a/library",
        search: { section: "fx", fx: "sound" },
        replace: true,
      });
    },
  );
});
