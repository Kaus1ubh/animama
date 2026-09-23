import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old bookmarks now land on the persistent Sounds Library. */
export const Route = createFileRoute("/a/sound-effects/new")({
  beforeLoad: () => {
    throw redirect({
      to: "/a/library",
      search: { section: "fx", fx: "sound" },
      replace: true,
    });
  },
});
