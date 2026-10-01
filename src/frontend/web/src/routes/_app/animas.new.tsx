import { createFileRoute } from "@tanstack/react-router";

import { CreateAnimaPage } from "@/ui/create-anima/CreateAnimaPage";
import { parseCreateAnimaSearch } from "@/ui/create-anima/createAnimaSearch";

export const Route = createFileRoute("/_app/animas/new")({
  validateSearch: parseCreateAnimaSearch,
  component: CreateAnimaRoute,
});

function CreateAnimaRoute() {
  const { avatar } = Route.useSearch();
  return <CreateAnimaPage avatar={avatar} />;
}
