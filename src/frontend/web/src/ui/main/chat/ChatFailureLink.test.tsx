import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  describeChatFailure,
  type ChatFailure,
  type ChatMessage,
} from "@animama/product-ui/chat";
import { ChatConversation } from "@animama/product-ui/components";

/** The transcript with one failed turn, as the chat shows it. */
function renderFailure(failure: ChatFailure) {
  const messages: ChatMessage[] = [
    { id: "run-1:user", role: "user", text: "hello", failure },
  ];
  return renderToStaticMarkup(
    <ChatConversation messages={messages} onRestoreMessage={() => {}} />,
  );
}

const download = "https://animama.example/download";
const trialComplete = (download_url?: unknown) =>
  describeChatFailure(
    {
      error: "trial_complete",
      code: "trial_complete",
      limit: "account_trial_ai",
      download_url,
    },
    "hello",
  );

describe("chat failure links", () => {
  it("opens the trial's desktop download in a new tab without an opener", () => {
    const html = renderFailure(trialComplete(download));
    expect(html).toContain("Your Animama trial is complete.");
    expect(html).toContain(
      "Download Animama to keep chatting with your Animas.",
    );
    const link = html.match(/<a [^>]*>Download Animama<\/a>/)?.[0] ?? "";
    expect(link).toContain(`href="${download}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it("shows the trial copy without a link when the URL is not safe", () => {
    const html = renderFailure(
      trialComplete("http://animama.example/download"),
    );
    expect(html).toContain("Your Animama trial is complete.");
    expect(html).not.toContain("<a ");
  });

  it("never renders an unsafe link a host put on a failure", () => {
    const html = renderFailure({
      ...trialComplete(download),
      link: { label: "Download Animama", href: "javascript:alert(1)" },
    });
    expect(html).not.toContain("<a ");
  });

  it("keeps other failures without a link", () => {
    const html = renderFailure(
      describeChatFailure(
        { error: "quota_exceeded", code: "quota_exceeded" },
        "hello",
      ),
    );
    // Static markup escapes apostrophes, so match copy without them.
    expect(html).toContain("hosted usage limit.");
    expect(html).toContain("Restore message");
    expect(html).not.toContain("<a ");
  });
});
