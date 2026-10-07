import { createFileRoute } from "@tanstack/react-router";

import { CreateHubPage } from "@/ui/create/CreateHubPage";

/**
 * `/effects/new`: the Create page with the Effects template picker open.
 * Closing the picker navigates to `/create`; choosing a starting point opens
 * that kind's creator route.
 */
export const Route = createFileRoute("/_app/effects/new")({
  component: EffectTemplatePickerRoute,
});

function EffectTemplatePickerRoute() {
  return <CreateHubPage effectPickerRoute />;
}
