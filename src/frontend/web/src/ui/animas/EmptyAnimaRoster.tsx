import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";

/** An admitted account can explore its Library while the runtime prepares its roster. */
export function EmptyAnimaRoster() {
  const { t } = useTranslation("animas");
  const appShell = useOptionalAppShell();
  return (
    <AppShellPage contentClassName="max-w-xl text-center">
      <Button
        type="button"
        variant="outline"
        className="self-start md:hidden"
        aria-label={t("roster.openSidebar")}
        onClick={appShell?.openSidebar}
      >
        {t("roster.menu")}
      </Button>
      <h1 className="text-lg font-semibold">{t("roster.title")}</h1>
      <p className="text-muted-foreground">{t("roster.description")}</p>
      <Button asChild variant="outline">
        <Link to="/library">{t("roster.openLibrary")}</Link>
      </Button>
    </AppShellPage>
  );
}
