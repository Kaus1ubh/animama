import type {
  ChatCrisisSupport,
  CrisisContact,
} from "@animama/product-ui/chat";
import { aiNoticeText, type AiNoticeState } from "@/lib/safety/aiNotice";
import { Button } from "@/ui/components/button";
import { cn } from "@/lib/utils";
import { SafetyProtocolDialog } from "./SafetyProtocolDialog";

export type CompanionSafetyViewProps = {
  notice: Pick<AiNoticeState, "kind" | "animaName"> | null;
  noticeVisible: boolean;
  crisis: ChatCrisisSupport | null;
  onDismissCrisis: () => void;
  className?: string;
};

function contactHref(contact: CrisisContact): string {
  if (contact.kind === "chat") return contact.value;
  return `${contact.kind === "sms" ? "sms" : "tel"}:${contact.value}`;
}

/** Deterministic crisis resources; the Anima cannot suppress or reword this (spec R4). */
export function CrisisCard({
  crisis,
  onDismiss,
}: {
  crisis: ChatCrisisSupport;
  onDismiss: () => void;
}) {
  const region = crisis.resources;
  return (
    <section
      role="alert"
      aria-label="Crisis support resources"
      className="border-border bg-card text-card-foreground pointer-events-auto w-full max-w-xl space-y-3 rounded-2xl border p-4 text-sm shadow-sm"
    >
      <p className="font-medium">
        If you&apos;re thinking about suicide or self-harm, you don&apos;t have
        to go through it alone. Trained people can help.
      </p>
      {region.services.length > 0 ? (
        <ul className="space-y-2">
          {region.services.map((service) => (
            <li key={service.name} className="space-y-1">
              <p className="font-medium">{service.name}</p>
              {service.description ? (
                <p className="text-muted-foreground text-xs">
                  {service.description}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {service.contacts.map((contact) => (
                  <a
                    key={`${contact.kind}-${contact.value}`}
                    href={contactHref(contact)}
                    // A new-window request lets the desktop shell hand calls,
                    // texts and chat links to the operating system in place.
                    target="_blank"
                    rel="noreferrer"
                    className="border-border hover:bg-muted rounded-full border px-3 py-1 text-xs font-medium"
                  >
                    {contact.label}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>Please contact a local crisis line or someone you trust.</p>
      )}
      <p>
        {region.emergency_number
          ? `If you're in immediate danger, call ${region.emergency_number}.`
          : "If you're in immediate danger, call your local emergency number."}
      </p>
      <p className="text-muted-foreground text-xs">
        Animas are AI and are not a substitute for professional help.
      </p>
      <div className="flex items-center justify-between gap-3">
        <SafetyProtocolDialog className="text-xs underline underline-offset-2" />
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}

/** Quiet, app-rendered AI notice (spec R2). Never focus-stealing or spoken. */
export function AiNotice({
  notice,
  visible,
}: {
  notice: Pick<AiNoticeState, "kind" | "animaName">;
  visible: boolean;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-hidden={visible ? undefined : true}
      data-visible={visible ? "true" : "false"}
      className={cn(
        // A soft backdrop keeps the line legible over the avatar scene.
        "text-muted-foreground bg-background/70 pointer-events-none rounded-full px-3 py-1 text-center text-xs backdrop-blur-sm transition-opacity duration-500 motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      {aiNoticeText(notice)}
    </p>
  );
}

/** The crisis card, then the AI notice; the host window decides where each is placed. */
export function CompanionSafetyView({
  notice,
  noticeVisible,
  crisis,
  onDismissCrisis,
  className,
}: CompanionSafetyViewProps) {
  if (!notice && !crisis) return null;
  return (
    <div className={cn("flex w-full flex-col items-center gap-2", className)}>
      {crisis ? (
        <CrisisCard crisis={crisis} onDismiss={onDismissCrisis} />
      ) : null}
      {notice ? <AiNotice notice={notice} visible={noticeVisible} /> : null}
    </div>
  );
}
