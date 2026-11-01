# Animama safety and crisis protocol

**If you are in immediate danger, call your local emergency number now.**

Animas are AI characters, not people. They are not a substitute for
professional help and do not provide therapy, counseling or medical treatment.
Like any AI, they can make mistakes, and they cannot call for help for you.

## Who Animama is for

Animama is for adults 18 and older; AI companions may not be suitable for some
minors. Setup asks you to confirm your age. Animama does not verify it.

## Knowing you're talking to an AI

- If you sincerely ask whether an Anima is a person, it is instructed to say it
  is an AI (it may play along inside a story you set up).
- The app shows a short notice, "You're talking with *name*, an AI — not a
  person," on your first message each day and after every 3 hours of
  continuing conversation. You can make the reminder more frequent in
  Settings → Safety.
- Animas are also instructed not to claim to be a therapist, not to pressure or
  guilt you into staying, and to support your relationships with other people.

## If you mention suicide or self-harm

- Animas are instructed to respond with care, encourage you to reach out to
  someone you trust or a crisis line, and never give methods or encouragement.
- A moderation check also reads your message. If it flags possible suicide or
  self-harm, the app shows a crisis card after the reply with crisis lines for
  your region. The Anima cannot hide or change the card.
  - On the Animama web demo, OpenAI's moderation service checks every message,
    whichever model the Anima uses.
  - Elsewhere, including the desktop app, only OpenAI Responses models check
    messages, as part of the same request. Other model providers don't show the
    card.
- The check can miss or misread messages. Chat is never blocked because of it.

## Crisis lines

| Region | Service | Contact | Emergency |
| --- | --- | --- | --- |
| United States | [988 Suicide & Crisis Lifeline](https://988lifeline.org/get-help/) | Call or text 988; chat online | 911 |
| Canada | [9-8-8: Suicide Crisis Helpline](https://988.ca/get-help) | Call or text 988 | 911 |
| United Kingdom | [Samaritans](https://www.samaritans.org/how-we-can-help/contact-samaritan/) | Call 116 123 | 999 |
| Ireland | [Samaritans Ireland](https://www.samaritans.org/ireland/how-we-can-help/contact-samaritan/) | Call 116 123 | 112 |
| Australia | [Lifeline](https://www.lifeline.org.au/) | Call 13 11 14; text 0477 13 11 14; chat online | 000 |
| New Zealand | [1737, Need to talk?](https://1737.org.nz/) | Call or text 1737 | 111 |

Last verified 2026-09-25. Your region comes from your system settings; change
it in Settings → Safety. Elsewhere, contact a local crisis line or emergency
number.

## Your data

- In the desktop app, the safety features send nothing beyond your normal
  request to the model provider you chose.
- On the web demo, I also send the text of each of your messages to OpenAI's
  moderation service for the check. [OpenAI says](https://developers.openai.com/api/docs/guides/your-data) it doesn't train on or
  keep these requests.
- Animama has no telemetry and reports crisis cards to no one.
- Chats are saved as usual. Animas are instructed not to save details of a
  suicide or self-harm crisis to memory unless you ask them to.
- For safety, Animama stores only when the AI notice was last shown, your age
  confirmation and your Safety settings. It never logs or stores crisis-check
  results.

A self-hosted server's operator can change or turn off the notice and crisis
card, and may log message previews. The desktop app always uses the defaults.
