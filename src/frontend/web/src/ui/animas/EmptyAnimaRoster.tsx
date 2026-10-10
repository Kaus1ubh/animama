import { Link } from "@tanstack/react-router";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import { AppShellPage } from "@/ui/app/AppShellPage";
import { Button } from "@/ui/components/button";

/** An admitted account can explore its Library while the runtime prepares its roster. */
export function EmptyAnimaRoster() {
  const appShell = useOptionalAppShell();
  return (
    <AppShellPage contentClassName="max-w-xl text-center">
      <Button
        type="button"
        variant="outline"
        className="self-start md:hidden"
        aria-label="Open sidebar"
        onClick={appShell?.openSidebar}
      >
        Menu
      </Button>
      <h1 className="text-lg font-semibold">Your Animas will appear here</h1>
      <p className="text-muted-foreground">
        There are no Animas in this account yet. You can explore your Library
        while your account is prepared. Creating Animas is unavailable in this
        hosted application.
      </p>
      <Button asChild variant="outline">
        <Link to="/library">Open Library</Link>
      </Button>
    </AppShellPage>
  );
}
