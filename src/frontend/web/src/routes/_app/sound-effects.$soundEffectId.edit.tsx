import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old bookmarks now land on the persistent Sounds Library. */
export const Route = createFileRoute("/_app/sound-effects/$soundEffectId/edit")(
  {
    beforeLoad: () => {
      throw redirect({
        to: "/library",
        search: { section: "fx", fx: "sound" },
        replace: true,
      });
    },
  },
);
