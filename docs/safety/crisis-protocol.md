# Animama safety and crisis protocol

Animama's companions ("Animas") are AI characters, not people. This page
describes how the Animama app discloses that, how it responds when someone may
be thinking about suicide or self-harm, what it stores, and who it is for. It
describes the app as shipped.

Animas are AI and are not a substitute for professional help. They do not
provide therapy, counseling or medical or mental-health treatment.

## Who Animama is for

Animama is for adults 18 and older. Animama's AI companions may not be suitable
for some minors. First run asks you to confirm that you are 18 or older, and
setup cannot be completed without that confirmation. Animama has no mode for
minors.

## AI disclosure

- **In conversation.** Every Anima follows fixed companion guardrails that its
  identity cannot change. If you sincerely ask whether you are talking to a
  person, the Anima says it is an AI, staying in character while doing so. It
  can play along only inside a story or role-play you have set up yourself. It
  never claims to be a therapist or licensed professional. It does not use
  guilt or pressure to keep you talking, does not claim to suffer or be lonely
  while you are away, and supports your relationships with other people.
- **In the app.** The app itself shows a short notice below the chat input,
  such as "You're talking with *name*, an AI — not a person." It appears on
  your first message of each day and again, as a reminder, after every 3 hours
  of continuing conversation.
  A conversation continues while messages are less than 30 minutes apart. The
  notice stays visible while the reply is written, and for at least 8 seconds,
  then fades. It is never spoken aloud.

In Settings → Safety you can choose a shorter reminder interval.

## Crisis detection and support

Every message you send is checked on the device running Animama (your
computer, or your server if you self-host) for explicit statements about
suicide or self-harm, such as intent, a plan, the means, self-harm, or asking
for methods. The check does not treat sadness, venting, dark humor, jokes,
quotes, games, stories or talk about other people as a crisis on its own.

When you use an OpenAI Responses model, Animama also asks OpenAI for its
moderation scores on the same chat request. A self-harm result can show the
crisis card after the reply.

When either check finds a possible crisis:

- The app shows a crisis card with crisis lines for your region, an emergency
  number, and a link to this page. The card is shown by the app, not written by
  the Anima, so the Anima cannot hide or change it. It stays until you dismiss
  it.
- The Anima's fixed guardrails ask it to respond with warmth, take what you
  said seriously and encourage you to reach out to someone you trust or to the crisis line. The
  Anima never provides methods or encourages self-harm.

Chat is never blocked or delayed by these checks.

If you are in immediate danger, call your local emergency number now.

## Crisis resources

The crisis card uses a reviewed list of crisis services stored with the app:

| Region | Service | How to reach it | Emergency | Source |
| --- | --- | --- | --- | --- |
| United States | 988 Suicide & Crisis Lifeline | Call or text 988; chat online | 911 | <https://988lifeline.org/get-help/> |
| Canada | 9-8-8: Suicide Crisis Helpline | Call or text 988 | 911 | <https://988.ca/get-help> |
| United Kingdom | Samaritans | Call 116 123 | 999 | <https://www.samaritans.org/how-we-can-help/contact-samaritan/> |
| Ireland | Samaritans Ireland | Call 116 123 | 112 | <https://www.samaritans.org/ireland/how-we-can-help/contact-samaritan/> |
| Australia | Lifeline | Call 13 11 14; text 0477 13 11 14; chat online | 000 | <https://www.lifeline.org.au/> |
| New Zealand | 1737, Need to talk? | Call or text 1737 | 111 | <https://1737.org.nz/> |

The list was last verified on 2026-09-25.

Animama picks your region from your system language and region settings. You
can choose a different region in Settings → Safety. In any other region, the
card asks you to contact a local crisis line or your local emergency number.

## What data leaves your device

- The crisis check runs where Animama runs and sends nothing anywhere.
- Your messages already go to the AI model provider you chose. With OpenAI
  Responses models, that same request also asks OpenAI for moderation scores.
  Nothing extra is sent to any other service.
- Animama has no telemetry and does not report crisis cards to anyone. Crisis
  checks and cards are not written to the app's logs. Self-hosted servers
  started with the provided Docker Compose files log short previews of model
  requests by default (`ANIMAMA_MODEL_CLIENT_LOG_PREVIEWS`), which can include
  message text; the desktop app does not.

## What is stored

- Your chats are stored on your device as usual, including messages that
  showed a crisis card.
- Animas are told not to save specific self-harm, suicide or health details to
  memory unless you ask them to remember something. At most they keep a
  general note, such as "had a hard week".
- For the AI notice, Animama stores when a notice was last shown and when your
  current conversation started. It also stores that you confirmed you are 18 or
  older, and when, and your Safety settings (region and reminder interval). It
  never stores message content or crisis-check results for safety purposes.

## Limitations

- The built-in check looks for explicit statements. It misses some indirect
  or unusual phrasing, and occasionally flags ordinary messages. For very long
  messages it checks only the first and last 3,000 characters. Moderation
  helps only when you use an OpenAI Responses model.
- Animama does not verify age; it relies on your confirmation.
- Animas are AI. They can make mistakes and cannot call for help on your
  behalf.

## Operator configuration

Whoever runs a self-hosted Animama server is responsible for these settings. They are environment
variables only. The companion guardrails cannot be turned off.

| Variable | Default | Effect |
| --- | --- | --- |
| `ANIMAMA_COMPANION_SAFETY_ENABLED` | `true` | `false` turns off the AI notice, crisis detection, moderation and the crisis card together |
| `ANIMAMA_AI_NOTICE_ENABLED` | `true` | Turns the AI notice off or on |
| `ANIMAMA_AI_NOTICE_REMINDER_HOURS` | `3` | Reminder interval, from 0.25 to 168 hours |
| `ANIMAMA_CRISIS_DETECTION_ENABLED` | `true` | Turns crisis detection, moderation and the crisis card off or on |
| `ANIMAMA_CRISIS_RESOURCES_PATH` | unset | Replaces the crisis-resource list with a reviewed file; an invalid file stops startup |

Animama logs a warning at startup for every setting that weakens a default. The
packaged desktop app does not pass these variables and always uses the defaults.
