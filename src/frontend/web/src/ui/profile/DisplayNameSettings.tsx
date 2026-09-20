"use client";

import { Loader2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { PyUserProfile } from "@animama/runtime-contracts/sdk";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeLocalDisplayName,
} from "@/lib/user-profile/display-name";
import { UserProfileApiError } from "@/lib/user-profile/errors";
import { useUserProfile } from "@/query/hooks/useUserProfile";
import { useUpdateUserProfile } from "@/query/mutations/useUpdateUserProfile";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";

function DisplayNameEditor({
  initialProfile,
}: {
  initialProfile: PyUserProfile;
}) {
  const inputId = useId();
  const [displayName, setDisplayName] = useState(
    initialProfile.display_name ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const updateProfile = useUpdateUserProfile();
  const normalized = normalizeLocalDisplayName(displayName);
  const changed = normalized !== initialProfile.display_name;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!changed || updateProfile.isPending) return;
    if (!normalized) {
      setError("Enter a display name between 1 and 80 characters.");
      return;
    }
    setError(null);
    try {
      await updateProfile.mutateAsync({ display_name: normalized });
      toast.success("Display name saved.");
    } catch (caught) {
      setError(
        caught instanceof UserProfileApiError
          ? caught.message
          : "Could not save your display name. Try again.",
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={inputId}>Display Name</Label>
          <span className="text-muted-foreground text-xs">
            {displayName.length}/{DISPLAY_NAME_MAX_LENGTH}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="min-w-0 flex-1"
            id={inputId}
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            required
            autoComplete="name"
            disabled={updateProfile.isPending}
            placeholder="Your name"
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError(null);
            }}
          />
          {changed ? (
            <Button
              type="submit"
              className="shrink-0"
              disabled={!normalized || updateProfile.isPending}
            >
              {updateProfile.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Save
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          This name is required and private to this Animama installation.
        </p>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Edit the private display name within App Settings without changing its owner. */
export function DisplayNameSettings() {
  const profile = useUserProfile();

  return (
    <section
      aria-label="Display name"
      className="border-border/60 bg-muted/10 rounded-xl border p-5"
    >
      {profile.data ? (
        <DisplayNameEditor
          key={profile.data.display_name ?? "__empty__"}
          initialProfile={profile.data}
        />
      ) : profile.isError ? (
        <div className="space-y-4 text-center">
          <p className="font-medium">Display name unavailable</p>
          <p className="text-muted-foreground text-sm">
            Animama could not load the local profile.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={profile.isFetching}
            onClick={() => void profile.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div
          className="text-muted-foreground flex min-h-24 items-center justify-center gap-2 text-sm"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          Loading display name…
        </div>
      )}
    </section>
  );
}
