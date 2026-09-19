---
name: intent-discovery
description: Interview the user to clarify a raw idea, problem or uncertain product intent before specification. Use when discovery is requested or material intent remains unresolved, not for an already-defined implementation task.
---

# Discover intent

Read the configured glossary, relevant decisions and current behavior. Treat existing
user answers and accepted requirements as inputs, not questions to repeat.

Investigate facts the repository can answer before asking the user. Separate what
exists, what was reported, what you reproduced and what is only proposed. Do not
infer product intent from current code or turn speculative improvements into scope.

Interview in small groups of dependent questions. Start with the problem and who
experiences it, then observable success, scope/non-goals, relevant constraints,
failure/recovery expectations and consequential tradeoffs. Use concrete options and
a recommendation where helpful; allow the user to correct the framing. Follow the
answers rather than running a fixed questionnaire. Investigate independent facts
while awaiting answers when the environment supports it.

Stop when a spec author can explain the outcome, audience, scope, constraints,
acceptance evidence and consequential choices without guessing. Record unresolved
questions honestly; a bounded research task is a valid next step. Do not exhaust
every hypothetical design branch or demand implementation choices prematurely.

Return a concise discovery brief with the problem, agreed outcome, scope, decisions,
evidence and remaining blockers. Distinguish tentative ideas from agreements.
The brief supplies the agreed inputs for `to-spec`.
