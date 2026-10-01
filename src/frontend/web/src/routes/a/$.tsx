import { createFileRoute } from "@tanstack/react-router";

/** Matches every legacy `/a/...` path so the parent `/a` route can redirect it. */
export const Route = createFileRoute("/a/$")({});
