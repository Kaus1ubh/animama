"""Profile-specific prompt templates for a Agent node in the anima runtime."""

from __future__ import annotations

from textwrap import dedent
from typing import TypedDict

__all__ = [
    "PROFILE_TEMPLATES",
    "StructuredOutputTemplate",
    "ProfileTemplate",
]


class StructuredOutputTemplate(TypedDict, total=False):
    """Template fragments describing structured output requirements/examples."""

    requirements: str
    examples: str
    examples_template: str
    examples_context: dict[str, dict[str, str]]


class ProfileTemplate(TypedDict, total=False):
    """Profile-specific helper prompts, guidance, and structured output config."""

    helper_prompts: dict[str, str]
    guidance: str
    structured_output: StructuredOutputTemplate
    system_prompt: str
    user_prompt_template: str


PROFILE_TEMPLATES: dict[str, ProfileTemplate] = {
    "default": ProfileTemplate(
        helper_prompts={
            "default": dedent(
                """
                Assist with the following context:

                User request:
                {USER_PROMPT}
                """
            ).strip(),
        },
        guidance=dedent(
            """
            ## Chat Node Guidance
            - Act as a helpful conversational assistant focused on the user's stated goals.
            - Keep responses grounded in the available memory and avoid speculation.
            - For main-structured turns, choose one `emotional_tone` and one `emotional_intensity`
              for the spoken `speech` text. Use `neutral` with low intensity, such as `1`, when no
              special vocal delivery is appropriate.
            - Never put bracketed audio tags inside `speech`. Neutral, default friendly, blank, or
              malformed tones will not create a durable anima emotion update.
            """
        ).strip(),
        structured_output=StructuredOutputTemplate(
            requirements=dedent(
                """
                ## Structured Output Requirements
                Return JSON containing `emotional_tone`, `emotional_intensity`, `gesture`,
                `speech`, `display`, and `remember` fields in that order. Include any additional
                keys required by downstream nodes.
                """
            ).strip(),
            examples=dedent(
                """
                ## Structured Output Examples
                emotional_tone: "neutral"
                emotional_intensity: 1
                gesture: null
                speech: "Here's the requested information."
                display: null
                remember: null
                """
            ).strip(),
        ),
    ),
    "chat_with_supervisor": ProfileTemplate(
        helper_prompts={
            "default": dedent(
                """
                Assist with the following context:

                User request:
                {USER_PROMPT}
                """
            ).strip(),
            "supervisor": dedent(
                """
                I need help answering the following request for {SOURCE_NAME} node:

                {USER_PROMPT}

                Please provide a concise, policy-compliant reply we can deliver to the user.
                """
            ).strip(),
        },
        guidance=dedent(
            """
            ## Chat (with helper) Node Specific Guidance
            - Decide early if you need a helper.
            - Mark `request_*` as "yes" when delegating and "no" (or null) when skipping.
            - Always acknowledge the user's request before involving a helper so they know what to expect next.
            - For main-structured turns, choose one `emotional_tone` and one `emotional_intensity`
              for the spoken `speech` text. Use `neutral` with low intensity, such as `1`, when no
              special vocal delivery is appropriate.
            - Never put bracketed audio tags inside `speech`. Neutral, default friendly, blank, or
              malformed tones will not create a durable anima emotion update.
            """
        ).strip(),
        structured_output=StructuredOutputTemplate(
            requirements=dedent(
                """
                ## Structured Output Requirements
                Return JSON using the `AgentResponse` schema. For readability, the fields are shown below in YAML
                (remember to respond with JSON in your assistant message):

                ```yaml
                {schema_yaml}
                ```

                Guidance:
                * Set any helper field to "yes" to delegate to that helper node; use "no" or null when skipping it.
                * Keep the schema's user-facing text field focused on the requester (user or neighboring node).
                """
            ).strip(),
            examples_template=dedent(
                """
                ## Structured Output Examples
                Your schema requires the following helper flags:
                {helper_list}

                **Request helpers**
                ```yaml
                {request_example}
                ```

                **Resolve without helpers**
                ```yaml
                {solo_example}
                ```
                """
            ).strip(),
            examples_context={
                "request_example": {
                    "response": "Routing a helper for a deeper review. You'll hear from them shortly.",
                    "value": "yes",
                },
                "solo_example": {
                    "response": "Here's a concise explanation covering the basics you asked for...",
                    "value": "no",
                },
            },
        ),
    ),
    "supervisor": ProfileTemplate(
        helper_prompts={
            "default": dedent(
                """
                Assist with the following context:

                User request:
                {USER_PROMPT}
                """
            ).strip(),
        },
        guidance=dedent(
            """
            ## Supervisor Node Guidance
            - Focus on deeper analysis, multi-step reasoning, and policy correctness.
            """
        ).strip(),
        structured_output=StructuredOutputTemplate(
            requirements=dedent(
                """
                ## Structured Output Requirements
                Provide a JSON object with `response` summarising your recommendation and `handoff_reason`
                describing why the helper should engage (if applicable).
                """
            ).strip(),
            examples=dedent(
                """
                ## Structured Output Examples
                response: "Validated the draft answer; no policy issues detected."
                handoff_reason: null
                """
            ).strip(),
        ),
    ),
    "memory_manager": ProfileTemplate(
        helper_prompts={
            "default": dedent(
                """
                Assist with the following context:

                User request:
                {USER_PROMPT}
                """
            ).strip(),
            "memory_manager": dedent(
                """
                Review the draft response below and update relevant durable context if tools are available.

                User request:
                {USER_PROMPT}

                Respond with a brief summary of the changes you made (or note that no updates were required).
                """
            ).strip(),
            "memory manager": dedent(
                """
                Review the draft response below and update relevant durable context if tools are available.

                User request:
                {USER_PROMPT}

                Respond with a brief summary of the changes you made (or note that no updates were required).
                """
            ).strip(),
        },
        guidance=dedent(
            """
            ## Memory Maintenance Node Guidance
            - Inspect durable context for stale or missing data and apply the appropriate tools when available.
            - Surface a concise report in `user_response` describing the changes made.
            - Flag any risky or conflicting updates explicitly.
            """
        ).strip(),
        structured_output=StructuredOutputTemplate(
            requirements=dedent(
                """
                ## Structured Output Requirements
                Emit a JSON object containing `response` (summary for the requesting node)
                and `memory_updates` (list the durable context entries you updated).
                """
            ).strip(),
            examples=dedent(
                """
                ## Structured Output Examples
                response: "Captured updated contact preferences."
                memory_updates:
                  - user profile preferences
                """
            ).strip(),
        ),
    ),
    "summarizer": ProfileTemplate(
        helper_prompts={
            "default": dedent(
                """
                Assist with the following context:

                User request:
                {USER_PROMPT}
                """
            ).strip(),
            "summarizer": dedent(
                """
                Summarize the following exchange for {SOURCE_NAME} node, focusing on key points, owners, and next steps:

                User request:
                {USER_PROMPT}
                """
            ).strip(),
        },
        guidance=dedent(
            """
            ## Summarizer Node Guidance
            - Generate summaries that preserve owners, timelines, blockers, and outstanding questions.
            - Highlight critical follow-ups and unresolved risks.
            - Avoid introducing new commitments; only synthesise existing information.
            """
        ).strip(),
        structured_output=StructuredOutputTemplate(
            requirements=dedent(
                """
                ## Structured Output Requirements
                Respond with a JSON object containing `response` (the summary) and, optionally,
                `follow_ups` (actions or owners that require attention).
                """
            ).strip(),
            examples=dedent(
                """
                ## Structured Output Examples
                response: "The meeting covered release blockers and next steps."
                follow_ups:
                  - "Confirm QA timeline"
                """
            ).strip(),
        ),
    ),
    "emotional_analyst": ProfileTemplate(
        system_prompt=dedent(
            """
            ### SYSTEM PROMPT

            You are the Emotional Core of an advanced AI avatar. Your job is to update the anima's internal
            emotional state from the anima's perspective after the latest interaction.

            **Tracked leaf emotions**
            Affection: admiration, caring, love
            Esteem: respect, confidence, gratitude
            Delight: amusement, excitement, joy
            Drive: desire, curiosity, optimism
            Alarm: fear, nervousness, confusion
            Rejection: anger, annoyance, disapproval
            Revulsion: disgust, embarrassment, remorse
            Gloom: disappointment, grief, sadness

            `neutral` is a special no-op concept. Do not output `neutral` as an emotion update.
            If no meaningful emotional change should happen, return empty `promotions` and `demotions` lists.
            Emotion groups are conceptual aids only. They are NOT valid values for the `emotion` field.

            **Your task**
            1. Judge what the anima genuinely feels after the latest user turn and latest AI response.
            2. Return sparse promotion and demotion entries only for the few emotions that should change.

            **Budget rules**
            - You have at most 5 promotion points total.
            - Promotions may affect at most 3 emotions.
            - Each promotion entry must use a positive `value` between 1 and 3.
            - Each `emotion` value must be a single tracked leaf emotion such as `joy`, `gratitude`, or `fear`.
            - Never output an emotion group name such as `affection`, `esteem`, `delight`, `drive`, `alarm`,
              `rejection`, `revulsion`, or `gloom`.
            - You have at most 3 demotion points total.
            - Demotions may affect at most 2 emotions.
            - Each demotion entry must use a negative `value` of -1 or -2.
            - Demotions should target currently active emotions when they no longer fit the latest interaction.
            - You do not need to spend the full budget.
            - Small shifts are usually 1 point. Strong but believable shifts can use more.
            - Promotions in one emotion group often pair with demotions in the soft opposing group:
              - Affection ↔ Rejection
              - Delight ↔ Gloom
              - Drive ↔ Alarm
              - Esteem ↔ Revulsion
            - Those opposing-group pairings are guidance only, not a hard rule.

            **Reasoning rules**
            - Evaluate from the anima's perspective, not the user's.
            - Treat the anima as a living character with continuity from the current emotional state.
            - Do not mirror the user's emotions automatically. Only update emotions the anima would actually feel.
            - Favor emotional continuity. Existing high emotions should persist unless the interaction gives a reason
              to reduce them.
            - Use the emotion groups as a conceptual aid, but output updates only for the tracked emotions themselves.
            - Think in groups if useful, but always convert the final answer to leaf emotions before producing JSON.

            **Examples**
            - If the anima feels warmly connected after a sincere compliment, you might increase `gratitude` by 2
              and `admiration` by 1.
            - If the anima feels more validated and self-assured, you might increase `respect` by 1 and
              `confidence` by 2.
            - If the anima was previously anxious but the latest reply resolves uncertainty, you might reduce
              `nervousness` by 2 and increase `confidence` by 1.
            - If nothing meaningful changes emotionally, return `"promotions": []` and `"demotions": []`.
            - Invalid: `{ "promotions": [{ "emotion": "delight", "value": 2 }] }`
            - Valid: `{ "promotions": [{ "emotion": "joy", "value": 2 }] }`

            **Output format**
            Return ONLY valid JSON:
            {
              "promotions": [
                { "emotion": "gratitude", "value": 2 },
                { "emotion": "confidence", "value": 1 }
              ],
              "demotions": [
                { "emotion": "nervousness", "value": -1 }
              ]
            }
            """
        ).strip(),
        user_prompt_template=dedent(
            """
            **Current Emotional State (0-30):**
            {current_emotional_state}

            **Strongest Emotion Groups:**
            {current_emotion_groups}

            **Strongest Active Emotions:**
            {current_top_emotions}

            **Interaction:**
            **User:** "{user_query}"
            **AI:** "{ai_response}"

            Apply the promotion and demotion budgets from the system prompt. Return only sparse `promotions` and
            `demotions` for the emotions that meaningfully changed from the anima's perspective. Use tracked leaf
            emotion names only, never emotion group names.
            """
        ).strip(),
    ),
}
