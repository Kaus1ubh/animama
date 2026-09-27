import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PyModelRoleAssignment } from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
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

import { modelOptionLabel } from "@/lib/chat/model-catalog";

import {
  embeddingsStatusText,
  roleCandidates,
} from "./model-configuration-state";

const DEFAULT_CHOICE = "__role_default__";

const ROLE_ROWS: ReadonlyArray<{
  role: ModelRole;
  label: string;
  description: string;
  defaultLabel: string;
}> = [
  {
    role: "utility",
    label: "Utility model",
    description:
      "Writes chat titles and summarizes long chats. Pick a small, fast model.",
    defaultLabel: "Default chat model",
  },
  {
    role: "memory_manager",
    label: "Memory Manager model",
    description:
      "Reviews conversations and proposes memory file changes. Needs tool calling.",
    defaultLabel: "Default chat model",
  },
  {
    role: "embeddings",
    label: "Embeddings model",
    description:
      "Finds uploaded-file and archive passages by meaning. Changing it re-embeds stored content.",
    defaultLabel: "Off",
  },
];

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
 * App Settings → Models → Model roles. Each role stores a catalog row id in
 * user preferences; the default chat model stays in General.
 */
export function ModelRolesSettings({ disabled }: { disabled: boolean }) {
  const { userPreferences, updateUserPreferences } = useSettings();
  const providers = useModelProviders();
  const roles = useModelRoles(true);
  const queryClient = useQueryClient();
  const ownerKey = useRuntimeOwnerId() ?? "__anon__";
  const items = providers.data ?? [];

  const choose = (role: ModelRole, value: string) => {
    const next = value === DEFAULT_CHOICE ? null : value;
    void updateUserPreferences(modelRolePatch(role, next))
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.modelConfiguration.roles(ownerKey),
        }),
      )
      .catch(() => toast.error("The model role could not be saved."));
  };

  return ROLE_ROWS.map(({ role, label, description, defaultLabel }) => {
    const stored = readModelRoleId(userPreferences, role);
    const candidates = roleCandidates(items, role, stored);
    const storedMissing =
      Boolean(stored) &&
      providers.isSuccess &&
      !candidates.some((item) => item.id === stored);
    const assignment = roles.data?.roles.find((entry) => entry.role === role);
    const notes = [
      effectiveNote(assignment),
      role === "embeddings"
        ? embeddingsStatusText(roles.data?.embeddings_refresh)
        : null,
    ].filter(Boolean);
    return (
      <SettingsRow
        key={role}
        label={label}
        description={description}
        control={
          <Select
            value={stored ?? DEFAULT_CHOICE}
            disabled={disabled || !providers.isSuccess}
            onValueChange={(value) => choose(role, value)}
          >
            <SelectTrigger className="w-56" aria-label={label}>
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
                  {modelOptionLabel(item)}
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
  });
}
