import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import {
  useLocalRuntime,
  type LocalOnboardingInput,
} from "@web/app/local-runtime/LocalRuntimeProvider";
import {
  clearSetupDraft,
  readSetupDraft,
  writeSetupDraft,
  type SetupDraft,
} from "@/app/local-runtime/setup-draft";
import { VoiceDownloads } from "@/ui/settings/VoiceDownloads";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import { DesktopCredentialsPanel } from "@/ui/settings/DesktopCredentialsPanel";
import { PARAKEET_DOWNLOADS_OFFERED } from "@/lib/speech/client-parakeet/assets";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeLocalDisplayName,
} from "@/lib/user-profile/display-name";

export const Route = createFileRoute("/setup")({
  component: LocalSetupRoute,
});

function LocalSetupRoute() {
  const { state, completeOnboarding } = useLocalRuntime();
  if (state.status !== "ready") return null;
  if (state.firstRunComplete) return <Navigate to="/a" replace />;
  return (
    <LocalSetupForm
      key={state.principalId}
      ownerId={state.principalId}
      completeOnboarding={completeOnboarding}
    />
  );
}

/** Mount the draft only after the installation owner is known. */
function LocalSetupForm({
  ownerId,
  completeOnboarding,
}: {
  ownerId: string;
  completeOnboarding: (input: LocalOnboardingInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => readSetupDraft(ownerId));
  const { displayName, adultConfirmed } = draft;
  const updateDraft = (change: Partial<SetupDraft>) => {
    const next = { ...draft, ...change };
    // Save during the event: a fallback restart after a failed key delivery
    // can still replace this renderer. Losing the draft only means retyping.
    writeSetupDraft(ownerId, next);
    setDraft(next);
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  // Unsaved API key edits would be lost by continuing; save or discard first.
  const [pendingKeys, setPendingKeys] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [declinedAge, setDeclinedAge] = useState(false);
  const normalizedName = normalizeLocalDisplayName(displayName);

  const submit = async (name: string) => {
    if (isSubmitting || providerBusy || pendingKeys > 0 || !adultConfirmed)
      return;
    setIsSubmitting(true);
    setError(null);
    try {
      await completeOnboarding({ displayName: name, adultConfirmed });
      clearSetupDraft(ownerId);
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
              updateDraft({ displayName: event.target.value });
              setError(null);
            }}
          />
        </div>
        {/* Key saves apply in place; only a rare fallback restart after failed
            delivery replaces this renderer, and the draft holds nothing secret. */}
        <DesktopCredentialsPanel
          onBusyChange={setProviderBusy}
          onPendingChange={setPendingKeys}
        />
        {/* Downloads install in place and keep running after setup. */}
        {PARAKEET_DOWNLOADS_OFFERED ? (
          <section className="space-y-4" aria-label="Optional voice downloads">
            <p className="text-muted-foreground text-sm">
              Optional. You can continue during downloads and manage them later
              in App Settings → Voice.
            </p>
            <VoiceDownloads section="all" />
          </section>
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
                updateDraft({ adultConfirmed: event.target.checked });
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
                updateDraft({ adultConfirmed: false });
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
        <div className="flex items-center justify-end gap-3">
          {pendingKeys > 0 ? (
            <p className="text-muted-foreground text-sm" role="status">
              Save or discard your API key changes to continue.
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={
              !normalizedName ||
              !adultConfirmed ||
              isSubmitting ||
              providerBusy ||
              pendingKeys > 0
            }
          >
            {isSubmitting ? "Saving…" : "Continue"}
          </Button>
        </div>
      </form>
    </main>
  );
}
