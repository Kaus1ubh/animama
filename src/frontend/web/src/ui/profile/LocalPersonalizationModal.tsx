"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";

type LocalPersonalizationModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function PersonalizationEditor({
  initialProfile,
  onSaved,
  onCancel,
}: {
  initialProfile: PyUserProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
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
      toast.success("Personalization saved.");
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof UserProfileApiError
          ? caught.message
          : "Could not save your personalization. Try again.",
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 px-6 pb-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="personalization-display-name">Display name</Label>
          <span className="text-muted-foreground text-xs">
            {displayName.length}/{DISPLAY_NAME_MAX_LENGTH}
          </span>
        </div>
        <Input
          id="personalization-display-name"
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
        <p className="text-muted-foreground text-xs">
          This name is required and private to this Animama installation.
        </p>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!normalized || !changed || updateProfile.isPending}
        >
          {updateProfile.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : null}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Edit the required private name without changing the installation owner. */
export function LocalPersonalizationModal({
  open,
  onOpenChange,
}: LocalPersonalizationModalProps) {
  const profile = useUserProfile({ enabled: open });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover overflow-hidden rounded-3xl p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Personalization</DialogTitle>
          <DialogDescription>
            Choose what Animama calls you on this installation.
          </DialogDescription>
        </DialogHeader>
        {profile.data ? (
          <PersonalizationEditor
            key={profile.data.display_name ?? "__empty__"}
            initialProfile={profile.data}
            onSaved={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : profile.isError ? (
          <div className="space-y-4 px-6 pb-6 text-center">
            <p className="font-medium">Personalization unavailable</p>
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
            className="text-muted-foreground flex min-h-40 items-center justify-center gap-2 px-6 pb-6 text-sm"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" />
            Loading personalization…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
