import { createFileRoute } from "@tanstack/react-router";
import { CreateHubPage } from "@/ui/create/CreateHubPage";

export const Route = createFileRoute("/a/create")({
  component: CreateHubPage,
});
