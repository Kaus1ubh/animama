import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/ui/components/button";
import { CreatorSaveNotice } from "./CreatorSaveNotice";

/**
 * Full-page state for a creator route whose saved item is missing or unreadable.
 * Replaces the workspace so a blank document cannot be mistaken for the item.
 */
export function CreatorUnavailableState({
  label,
  message,
}: {
  /** Singular content name, such as "Avatar Effect". */
  label: string;
  message: string;
}) {
  const { t } = useTranslation("creator");
  return (
    <div className="bg-background flex h-full items-center justify-center p-4">
      <CreatorSaveNotice
        className="w-full max-w-md text-sm"
        tone="error"
        message={
          <>
            <span className="block font-medium">
              {t("unavailable.title", { label })}
            </span>
            <span className="text-muted-foreground">{message}</span>
          </>
        }
        actions={
          <div className="flex w-full justify-end gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/library">{t("unavailable.openLibrary")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/create">{t("unavailable.goToCreate")}</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
