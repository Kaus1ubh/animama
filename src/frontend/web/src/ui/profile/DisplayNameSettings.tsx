"use client";

import { Loader2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { PyUserProfile } from "@animama/runtime-contracts/sdk";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeLocalDisplayName,
} from "@/lib/user-profile/display-name";
import { UserProfileApiError } from "@/lib/user-profile/errors";
import { cn } from "@/lib/utils";
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
  const { t } = useTranslation("settings");
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
      setError(
        t("profile.displayName.required", { max: DISPLAY_NAME_MAX_LENGTH }),
      );
      return;
    }
    setError(null);
    try {
      await updateProfile.mutateAsync({ display_name: normalized });
      toast.success(t("profile.displayName.saved"));
    } catch (caught) {
      setError(
        caught instanceof UserProfileApiError
          ? caught.message
          : t("profile.displayName.saveFailed"),
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={inputId}>{t("profile.displayName.fieldLabel")}</Label>
          <span className="text-muted-foreground text-xs">
            {t("profile.displayName.count", {
              length: displayName.length,
              max: DISPLAY_NAME_MAX_LENGTH,
            })}
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
            placeholder={t("profile.displayName.placeholder")}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError(null);
            }}
          />
          <Button
            type="submit"
            className="shrink-0"
            disabled={!changed || !normalized || updateProfile.isPending}
          >
            {updateProfile.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {t("profile.displayName.save")}
          </Button>
        </div>
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
export function DisplayNameSettings({ className }: { className?: string }) {
  const { t } = useTranslation("settings");
  const profile = useUserProfile();

  return (
    <section
      aria-label={t("profile.displayName.label")}
      className={cn(
        "border-border/60 bg-muted/10 rounded-xl border p-5",
        className,
      )}
    >
      {profile.data ? (
        <DisplayNameEditor
          key={profile.data.display_name ?? "__empty__"}
          initialProfile={profile.data}
        />
      ) : profile.isError ? (
        <div className="space-y-4 text-center">
          <p className="font-medium">{t("profile.displayName.unavailable")}</p>
          <p className="text-muted-foreground text-sm">
            {t("profile.displayName.loadFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={profile.isFetching}
            onClick={() => void profile.refetch()}
          >
            {t("actions.tryAgain")}
          </Button>
        </div>
      ) : (
        <div
          className="text-muted-foreground flex min-h-24 items-center justify-center gap-2 text-sm"
          role="status"
        >
          <Loader2 className="size-4 animate-spin" />
          {t("profile.displayName.loading")}
        </div>
      )}
    </section>
  );
}
