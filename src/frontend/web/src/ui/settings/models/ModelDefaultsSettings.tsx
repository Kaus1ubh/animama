import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PyModelRoleAssignment } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import {
  modelRolePatch,
  readModelRoleId,
  type ModelRole,
} from "@/lib/settings/preferences";
import { useModelRoles } from "@/query/hooks/useModelConfiguration";
import { useModelProviders } from "@/query/hooks/useModelProviders";
import { queryKeys } from "@/query/keys";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { SettingsRow } from "@/ui/settings/SettingsLayout";
import { useSettings } from "@/ui/settings/SettingsProvider";

import { alternateModelIds, modelOptionLabel } from "@/lib/chat/model-catalog";

import {
  embeddingsStatusText,
  roleCandidates,
} from "./model-configuration-state";

const DEFAULT_CHOICE = "__role_default__";

/** Copy for each default model section in App Settings → Models. */
export const MODEL_DEFAULTS: Record<
  ModelRole,
  { label: string; description: string; defaultLabel: string }
> = {
  chat: {
    label: "Chat",
    description:
      "The model new Animas start with. Existing Animas keep their own.",
    defaultLabel: "System default",
  },
  memory_manager: {
    label: "Memory Manager",
    description:
      "Reviews conversations and proposes memory file changes. Needs tool calling.",
    defaultLabel: "Same as Chat",
  },
  utility: {
    label: "Compaction",
    description:
      "Writes chat titles and compacts long chats. A small, fast model works well.",
    defaultLabel: "Same as Chat",
  },
  embeddings: {
    label: "Embeddings",
    description:
      "Finds file and archive passages by meaning. Changing it re-embeds stored content.",
    defaultLabel: "Off",
  },
};

/** Where the role's model comes from when the owner has not chosen one. */
function effectiveNote(
  assignment: PyModelRoleAssignment | undefined,
): string | null {
  if (!assignment) return null;
  if (!assignment.assignment_available)
    return "The chosen model is unavailable, so the default is used.";
  if (assignment.source === "off")
    return assignment.role === "embeddings"
      ? null
      : "No model can do this job; choose one with the capabilities it needs.";
  if (assignment.source === "owner") return null;
  const model = assignment.model_label ?? assignment.model_provider_id;
  const connection = assignment.connection_name
    ? ` (${assignment.connection_name})`
    : "";
  return model ? `Currently ${model}${connection}.` : null;
}

/**
 * One default model in App Settings → Models. Each role stores a catalog row
 * id in user preferences; the server reports the model in effect.
 */
export function ModelDefaultSetting({
  role,
  disabled,
}: {
  role: ModelRole;
  disabled: boolean;
}) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const providers = useModelProviders();
  const roles = useModelRoles(true);
  const queryClient = useQueryClient();
  const ownerKey = useRuntimeCacheKey() ?? "__anon__";
  const { label, description, defaultLabel } = MODEL_DEFAULTS[role];

  const stored = readModelRoleId(userPreferences, role);
  const candidates = roleCandidates(providers.data ?? [], role, stored);
  const alternates = alternateModelIds(candidates);
  const storedMissing =
    Boolean(stored) &&
    providers.isSuccess &&
    !candidates.some((item) => item.id === stored);
  const assignment = roles.data?.roles.find((entry) => entry.role === role);
  const notes = [
    providers.isError ? "Models could not be loaded." : null,
    effectiveNote(assignment),
    role === "embeddings"
      ? embeddingsStatusText(roles.data?.embeddings_refresh)
      : null,
  ].filter(Boolean);

  const choose = (value: string) => {
    const next = value === DEFAULT_CHOICE ? null : value;
    void updateUserPreferences(modelRolePatch(role, next))
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.modelConfiguration.roles(ownerKey),
        }),
      )
      .catch(() => toast.error(`The ${label} model could not be saved.`));
  };

  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <Select
          value={stored ?? DEFAULT_CHOICE}
          disabled={disabled || !providers.isSuccess}
          onValueChange={choose}
        >
          <SelectTrigger className="w-56" aria-label={`${label} model`}>
            <SelectValue placeholder={defaultLabel} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_CHOICE}>{defaultLabel}</SelectItem>
            {storedMissing && stored ? (
              <SelectItem value={stored} disabled>
                {stored} (unavailable)
              </SelectItem>
            ) : null}
            {candidates.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {modelOptionLabel(item, alternates.has(item.id))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {notes.length > 0 ? (
        <p className="text-muted-foreground text-xs" role="status">
          {notes.join(" ")}
        </p>
      ) : null}
    </SettingsRow>
  );
}
