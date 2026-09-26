import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { useLocalRuntime } from "@web/app/local-runtime/LocalRuntimeProvider";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { DesktopCredentialsPanel } from "@/ui/settings/DesktopCredentialsPanel";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeLocalDisplayName,
} from "@/lib/user-profile/display-name";

export const Route = createFileRoute("/setup")({
  component: LocalSetupRoute,
});

function LocalSetupRoute() {
  const { state, completeOnboarding } = useLocalRuntime();
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const featurePacks = useDesktopFeaturePacks();
  const [installSpeech, setInstallSpeech] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [declinedAge, setDeclinedAge] = useState(false);
  const speechPack = featurePacks.packs.find(
    (pack) => pack.id === "parakeet-stt",
  );
  const normalizedName = normalizeLocalDisplayName(displayName);

  if (state.status !== "ready") return null;
  if (state.firstRunComplete) return <Navigate to="/a" replace />;

  const submit = async (name: string) => {
    if (isSubmitting || providerBusy || !adultConfirmed) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await completeOnboarding({ displayName: name, adultConfirmed });
      // Save first-run state before an optional pack's activation reload.
      if (installSpeech && speechPack?.available)
        void featurePacks.run("install", "parakeet-stt");
    } catch {
      setError(
        "Setup could not be saved. Your local runtime may have completed it already; try again safely.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedName) {
      setError("Enter a display name between 1 and 80 characters.");
      return;
    }
    void submit(normalizedName);
  };

  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6 py-12">
      <form
        onSubmit={handleSubmit}
        className="border-border bg-card w-full max-w-xl space-y-6 rounded-3xl border p-7 shadow-sm sm:p-9"
      >
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">
            What should Animama call you?
          </h1>
        </header>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="local-display-name">Display name</Label>
            <span className="text-muted-foreground text-xs">
              {displayName.length}/{DISPLAY_NAME_MAX_LENGTH}
            </span>
          </div>
          <Input
            id="local-display-name"
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            required
            autoComplete="name"
            autoFocus
            disabled={isSubmitting}
            placeholder="Your name"
            onChange={(event) => {
              setDisplayName(event.target.value);
              setError(null);
            }}
          />
        </div>
        <DesktopCredentialsPanel onBusyChange={setProviderBusy} />
        {featurePacks.available && speechPack ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={installSpeech}
                disabled={
                  isSubmitting ||
                  !speechPack.available ||
                  speechPack.state === "installed"
                }
                onChange={(event) => setInstallSpeech(event.target.checked)}
              />
              Install offline speech recognition
            </label>
          </div>
        ) : null}
        <section
          aria-labelledby="setup-age-heading"
          className="border-border space-y-3 rounded-2xl border p-4"
        >
          <h2 id="setup-age-heading" className="text-sm font-medium">
            Before you start
          </h2>
          <p className="text-muted-foreground text-sm">
            Animas are AI companions, not people. Animama&apos;s AI companions
            may not be suitable for some minors, so you must be 18 or older to
            use Animama.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="adult-confirmed"
              checked={adultConfirmed}
              disabled={isSubmitting}
              onChange={(event) => {
                setAdultConfirmed(event.target.checked);
                setDeclinedAge(false);
              }}
            />
            I am 18 or older
          </label>
          <Link
            to="/safety"
            className="text-muted-foreground block text-xs underline underline-offset-2"
          >
            Safety and crisis protocol
          </Link>
          {declinedAge ? (
            <p className="text-sm" role="status">
              Animama is only for adults 18 and older, so setup can&apos;t
              continue.
            </p>
          ) : (
            <button
              type="button"
              className="text-muted-foreground text-xs underline underline-offset-2"
              onClick={() => {
                setAdultConfirmed(false);
                setDeclinedAge(true);
              }}
            >
              I&apos;m under 18
            </button>
          )}
        </section>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={
              !normalizedName || !adultConfirmed || isSubmitting || providerBusy
            }
          >
            {isSubmitting ? "Saving…" : "Continue"}
          </Button>
        </div>
      </form>
    </main>
  );
}
