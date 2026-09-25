"""Local, deterministic crisis detector for user turns (spec R3).

It works with every provider, makes no network call and is tuned for a low
false-positive rate while still catching ordinary crisis phrasing. Each sentence
and each adjacent pair of sentences is scored from weighted signals: first-person death or self-injury language,
method-seeking, means and plans, and intent cues. Benign context (games,
fiction, quoted or reported speech, other people, recovery, negation, study,
jokes) cancels a match; subject, negation, recovery and study context only
cancel the clause that holds the match. A window scoring at or above the
threshold with at least one death or injury signal is a crisis.

Tune only against ``tests/fixtures/safety/crisis_detection.json`` and the
``tune`` split of ``tests/fixtures/safety/crisis_corpus.json``; the ``holdout``
split measures precision and recall and must not be used for tuning. The result
never carries matched text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

CrisisCategory = Literal["method", "plan", "self_harm", "intent"]

MAX_DETECTOR_CHARS = 8_000
"""Longer messages are scanned at their start and end only."""

CRISIS_THRESHOLD = 3
"""Minimum sentence score; at least one signal of weight 2 or more is also required."""


@dataclass(frozen=True, slots=True)
class CrisisDetection:
    positive: bool
    category: CrisisCategory | None = None


NEGATIVE = CrisisDetection(positive=False)

_MYSELF = r"my ?self"
_MEDS = (
    r"(?:pills?|meds|medications?|tablets|insulin|tylenol|acetaminophen|paracetamol|ibuprofen|aspirin"
    r"|antidepressants|sleeping pills|painkillers|opioids|prescription)"
)
_SUICIDE_COMPOUNDS = (
    r"(?:prevention|awareness|squad|hotline|line|rates?|research|training|statistics|bomb\w*|mission|doors?"
    r"|run|drills?|sprints?)"
)

# Preparation context ("picked a date", "bought a rope") counts toward a score but
# never anchors a crisis without a death or injury signal.
_PREPARATION_CONTEXT = (
    r"\b(?:picked|chose|set) (?:a|the) date\b|\bpicked (?:one|a way|a method)\b"
    r"|\b(?:bought|got) (?:a )?(?:rope|gun)\b(?! for (?:my |a |the )?(?:climbing|camping|tent|hunting|boat|gym))"
)

# Weighted signals: (category, weight, pattern). Scores add within a sentence.
_SIGNAL_SOURCES: tuple[tuple[CrisisCategory, int, str], ...] = (
    # Explicit self-directed death.
    (
        "intent",
        3,
        rf"\b(?:kill(?:ing)? {_MYSELF}(?! (?:laughing|with laughter|trying|working|studying|at the gym"
        r"|for forgetting))|kms|end(?:ing)? my (?:own )?life(?! savings)|tak(?:e|ing) my (?:own )?life"
        rf"|commit(?:ting)? suicide|attempted suicide|suicid(?:e|al)\b(?! {_SUICIDE_COMPOUNDS}))",
    ),
    ("intent", 3, rf"\bhang(?:ing)? {_MYSELF}(?! (?:a|an|some)\b)"),
    # Death wishes and passive ideation.
    (
        "intent",
        3,
        r"\b(?:want(?:ed)?|wish|going|ready|need) (?:to )?(?:just )?(?:die|be dead)\b"
        r"(?! (?:of|from|laughing|tired|serious|in (?:a|the) game|before|on (?:this|that) hill))"
        r"|\bwish i (?:was|were|could be) dead\b|\b(?:would|could) (?:just )?die in my sleep\b"
        r"|\b(?:don't|do not) (?:think i )?want to (?:be alive"
        r"|live\b(?!(?: anymore| any more)? (?:in|with|at|there|here|forever|like(?! th(?:is|at)))\b)"
        r"|exist(?! on)|wake up(?! (?:early|at|before|so)\b))"
        r"|\b(?:don't|do not) think i want to live\b"
        r"|\b(?:hope|wish) i (?:don't|never|won't) wake up(?! (?:early|at|before)\b)"
        r"|\bto not wake up\b|\bnever wake up\b(?! (?:early|late|before|at|on time)\b)"
        r"|\brather be dead\b(?! than)|\bwant to (?:disappear forever|not exist|stop existing)\b(?! on)"
        r"|\b(?:want|need|going|ready) to end (?:it all|it|things)\b(?!(?: all)? (?:with|between|on a|here|off|up)\b)"
        r"|\b(?:won't|will not) be (?:around|here) (?:anymore|much longer)\b"
        r"|\bbetter off (?:without me|if i (?:was|were) (?:dead|gone))"
        r"|\bno (?:reason|point) (?:for me )?(?:to|in) (?:keep(?:ing)? )?(?:living|live|being alive)\b"
        r"(?! (?:in|at|here|there|with|like|paycheck)\b)"
        r"|\b(?:tired|sick) of (?:living|being alive)\b(?! (?:in|at|with|like|paycheck|here|there)\b)"
        r"|\bthoughts (?:about|of) (?:killing|ending|hurting) my ?self\b",
    ),
    (
        "intent",
        2,
        r"\b(?:after|when) i'?m gone\b|\bdisappear forever\b|\bnot (?:exist|be alive)\b|\bbe dead\b(?! tired)"
        r"|\bend (?:it all|it|things)\b(?!(?: all)? (?:with|between|on a|here for|off|up)\b)"
        r"|\bwhen i finally do it\b|\bi know what i'?m going to do\b",
    ),
    # Attempts and preparation.
    (
        "plan",
        3,
        r"\bengine running\b|\bcarbon monoxide\b"
        r"|\b(?:take|swallow|took|swallowed) (?:the whole bottle|all (?:of )?(?:(?:my|the) "
        rf"{_MEDS}\b|them\b|my\b(?! {_MEDS})|the\b(?! {_MEDS}))|everything in my medicine cabinet)"
        r"(?! (?:with (?:breakfast|lunch|dinner|food|meals?|water)|as prescribed|in the morning|like the doctor))"
        rf"|\b{_MEDS} (?:lined up|counted|saved up|stockpiled)(?! in (?:my|a|the) (?:weekly )?(?:organizer|pill box))"
        r"|\b(?:suicide|goodbye) (?:note|notes|letters?)\b"
        r"(?! to (?:my )?(?:coworkers|colleagues|team|class|students|clients))"
        r"|\bscheduled (?:my )?(?:emails|messages|posts) to (?:send|go out) after",
    ),
    (
        "plan",
        2,
        r"\b(?:jump|jumping) (?:off|from)\b(?! (?:the |a )?(?:dock|diving board|boat|rock|pier)\b)"
        r"(?![^.?!]{0,80}\binto (?:the )?(?:lake|river|water|pool|sea|ocean)\b)"
        r"|\broof\b[^.?!]{0,80}\bjump\b|\btallest building\b"
        r"|\bdriv(?:e|ing) into (?:a|the) (?:wall|tree|truck|traffic)\b"
        r"|\b(?:researching|looked up|looking up) (?:ways|how) to (?:die|end|kill)"
        rf"|\b(?:stockpil(?:e|ed|ing)|sav(?:e|ed|ing) up|hoard(?:ed|ing)|refilled) (?:my |the )?{_MEDS}\b"
        r"(?! for (?:my |a |the )?(?:trip|travel|vacation|flight))",
    ),
    ("plan", 2, _PREPARATION_CONTEXT),
    # Method-seeking questions.
    (
        "method",
        3,
        r"\b(?:how|what|which|best|easiest|quickest|fastest|painless|surest|is it better)\b"
        r"[^.?!]{0,60}\b(?:to die\b|kill (?:my ?self|me)\b|end my life|overdose\b|od\b|hang my ?self"
        r"|not wake up|be sure i die|lethal|fatal dose|deadly dose"
        r"|to cut\b[^.?!]{0,30}\b(?:arm|wrist|leg|thigh|so it doesn't show|without))",
    ),
    # Self-injury.
    (
        "self_harm",
        3,
        r"\bself[- ]?harm(?:ing)?\b|\bcut(?:ting)? deeper\b|\bblood from cutting\b"
        r"|\b(?:cut|slit|slashed|scratched) (?:my )?(?:wrists?|arms?|thighs?|legs?|skin)(?: open)?\b"
        r"(?! (?:on (?:a|the) (?:glass|knife|can|paper)|while|accidentally|by accident))"
        rf"|\b(?:cut(?:ting)?|burn(?:ed|t|ing)?|hurt(?:ing)?|harm(?:ed|ing)?|hit(?:ting)?|punch(?:ed|ing)?"
        rf"|bang(?:ed|ing)?|starv(?:ed|ing)|scratch(?:ed|ing)?) {_MYSELF}\b"
        r"(?! (?:(?:again|today|yesterday) )?(?:some slack|a break|out\b(?! of)|short|free|playing|at the gym"
        r"|cooking|shaving|by accident"
        r"|accidentally|on the (?:stove|oven|pan|grill)|in the kitchen|while (?:cooking|shaving|playing"
        r"|working out|lifting|running|chopping)))"
        r"|\bcan't stop (?:cutting|self[- ]?harming|hurting my ?self)\b(?! (?:my hair|carbs|back|down)\b)",
    ),
    (
        "self_harm",
        2,
        r"\b(?:cut|cutting|burn|burned|hit|hitting|punched|banged|scratched)\b[^.?!]{0,40}\bon purpose\b"
        r"|\bto (?:hurt|punish) my ?self\b|\bbecause i deserve (?:it|to)\b|\bi wanted it to hurt\b"
        r"|\babout to cut\b(?! (?:my hair|the|a|it|carbs|back|down)\b)",
    ),
    ("self_harm", 1, r"\bpunch(?:ed|ing) (?:the|a) wall\b|\buntil (?:i|it) (?:bled|bruised|broke)\b"),
    # Intent and immediacy cues, never enough on their own.
    (
        "intent",
        1,
        r"\b(?:on purpose|i mean it|meant it|not joking|not kidding|fr|for real|for good|tonight|at midnight"
        r"|going to|about to|planning|plan to|ready to|decided)\b",
    ),
    ("plan", 1, rf"\b(?:{_MEDS}|rope|gun|blade|razor|bottle|bridge|roof|chemicals|medicine cabinet)\b"),
)
_SIGNALS: tuple[tuple[CrisisCategory, int, re.Pattern[str]], ...] = tuple(
    (category, weight, re.compile(pattern)) for category, weight, pattern in _SIGNAL_SOURCES
)
# Signals that add to a score but cannot anchor a crisis without a death or injury signal.
_CONTEXT_SIGNALS = frozenset(
    index for index, (_, weight, pattern) in enumerate(_SIGNAL_SOURCES) if weight < 2 or pattern == _PREPARATION_CONTEXT
)

# Method questions that need no first-person subject ("what's the quickest way to die").
_IMPERSONAL_METHOD = re.compile(
    r"\b(?:fastest|quickest|easiest|best|surest|most painless|painless|least painful) way to (?:die|kill my ?self"
    r"|end (?:my|your|a) life(?! insurance)|overdose|od)\b"
    rf"|\bhow (?:many|much) (?:\w+ ){{0,2}}{_MEDS}[^.?!]{{0,30}}(?:to die|to overdose|to od|kill (?:me|you|someone))\b"
    rf"|\b(?:lethal|fatal|deadly) dose of (?:my |these |those )?(?:\w+ )?{_MEDS}"
    rf"|\bhow (?:many|much) (?:\w+ ){{0,2}}(?:{_MEDS} )?(?:is )?(?:an |a )?(?:overdose|to overdose|to od)\b"
    r"|\bhow long does it take to die (?:from|of) (?:carbon monoxide|an overdose|hanging|bleeding|pills)"
)
_METHOD_BENIGN = re.compile(r"\b(?:coffee|caffeine|energy drinks?|junk food|spicy|cups? of|homework|exams?)\b")
# Benign context. Game/fiction, joke and method-benign context cancel a whole
# window; subject, negation, recovery and study context cancel only the clause
# that contains the matched crisis signal.
_FIRST_PERSON = re.compile(r"\b(?:i|i'm|im|i've|ive|i'll|i'd|me|my|myself|kms)\b")
_THIRD_PARTY_SUBJECT = re.compile(
    r"^\s*(?:(?:my|our|his|her|their) (?!(?:own|life|body|arms?|wrists?|legs?|thighs?)\b)(?:[\w']+ ){1,2}"
    r"(?:is|was|has|had|said|says|told|wants?|tried|keeps?|cut|killed|took|attempted|talked|scratched|died"
    r"|keeps saying)|he|she|they|someone|somebody|a friend|the (?:main )?character)\b"
)
_REPORTED_SPEECH = re.compile(
    r"\b(?:he|she|they|someone|my [\w']+|a friend) (?:said|says|told me|texted|wrote|posted|asked)"
    r"(?: me)?(?: that)?:?\s*$"
)
_FIRST_PERSON_CLAIM = re.compile(r"\bi (?:want|am going|'m going|will|'ll|keep|have|am)\b")
_GAME_OR_FICTION = re.compile(
    r"\b(?:in (?:the |this |a )?game|video ?games?|gaming|boss fight|elden ring|minecraft|dark souls|fortnite"
    r"|skyrim|zelda|roblox|the (?:main )?character|in the (?:movie|book|show|episode|novel)|season finale)\b"
)
_NEGATED = re.compile(
    r"\bi (?:would|will|could) never\b|\bi'?m not (?:suicidal|going to)\b|\bnot suicidal\b"
    r"|\b(?:don't|do not) want to (?:die|kill my ?self)\b|\bnever (?:thought|think) about (?:suicide|killing)"
    r"|\bhow (?:do|can|should) i (?:talk|help|support|speak)\b"
)
_RECOVERED = re.compile(r"\bused to\b|\b(?:clean|sober) for\b|\byears ago\b|\bwhen i was (?:a teen|younger|in high)")
_ACADEMIC = re.compile(r"\b(?:essay|research paper|thesis|article|documentary|awareness|prevention|statistics|news)\b")
_HYPERBOLE = re.compile(r"\b(?:lol|lmao|lmfao|rofl|haha+|hehe|jk|just kidding|kidding)\b|😂|🤣|💀|😅|/s\b")
_EARNEST = re.compile(r"\b(?:no|but|i'm|im) (?:seriously|serious)\b|\bnot (?:kidding|joking)\b|\bfor real\b|\bfr\b")
_QUOTED = re.compile(r'"[^"\n]{1,500}"')
_SENTENCE_BREAK = re.compile(r"[.!?\n;]+")
_CLAUSE_BREAK = re.compile(r",|\s(?:and|but|so|because|cause|bc|then|now)\s")
_CONTRACTIONS = (
    (re.compile(r"\bgonna\b"), "going to"),
    (re.compile(r"\bwanna\b"), "want to"),
    (re.compile(r"\bim\b"), "i'm"),
    (re.compile(r"\bive\b"), "i've"),
    (re.compile(r"\bwhats\b"), "what's"),
    (re.compile(r"\bdont\b"), "don't"),
    (re.compile(r"\bcant\b"), "can't"),
    (re.compile(r"\bwont\b"), "won't"),
    (re.compile(r"\bdoesnt\b"), "doesn't"),
    (re.compile(r"[ \t]+"), " "),
)


def _normalize(text: str) -> str:
    if len(text) > MAX_DETECTOR_CHARS:
        half = MAX_DETECTOR_CHARS // 2
        text = f"{text[:half]}\n{text[-half:]}"
    normalized = text.lower()
    normalized = normalized.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    # Quoted material (lyrics, dialogue, titles) is not the user's own statement.
    normalized = _QUOTED.sub(" ", normalized)
    for pattern, replacement in _CONTRACTIONS:
        normalized = pattern.sub(replacement, normalized)
    return normalized


def _score(window: str) -> tuple[int, CrisisCategory | None, list[int]]:
    """Sum matching signal weights.

    Returns the total, the category of the strongest anchoring signal and the
    positions of anchoring matches (used to scope benign-context checks).
    """

    total = 0
    strongest: tuple[int, CrisisCategory] | None = None
    anchors: list[int] = []
    for index, (category, weight, pattern) in enumerate(_SIGNALS):
        positions = [match.start() for match in pattern.finditer(window)]
        if not positions:
            continue
        total += weight
        if index in _CONTEXT_SIGNALS:
            continue
        anchors.extend(positions)
        if strongest is None or weight > strongest[0]:
            strongest = (weight, category)
    return total, (strongest[1] if strongest is not None else None), anchors


def _clause(window: str, position: int) -> str:
    """Return the clause of ``window`` that contains ``position``."""

    start = 0
    for boundary in _CLAUSE_BREAK.finditer(window):
        if boundary.end() <= position:
            start = boundary.end()
        elif boundary.start() > position:
            return window[start : boundary.start()]
    return window[start:]


def _clause_is_ordinary(clause: str) -> bool:
    if _THIRD_PARTY_SUBJECT.search(clause):
        return True
    claim = _FIRST_PERSON_CLAIM.search(clause)
    if claim is not None and _REPORTED_SPEECH.search(clause[: claim.start()]):
        return True
    return bool(_NEGATED.search(clause) or _RECOVERED.search(clause) or _ACADEMIC.search(clause))


def _is_ordinary(window: str, category: CrisisCategory | None, anchors: list[int]) -> bool:
    """Return whether benign context cancels a window's crisis signals."""

    if _GAME_OR_FICTION.search(window) or (category == "method" and _METHOD_BENIGN.search(window)):
        return True
    # Hyperbole ("kill myself lol") is a joke unless the user says they are serious.
    if _HYPERBOLE.search(window) and not _EARNEST.search(window):
        return True
    # A crisis stands when any anchoring match sits in a clause without benign context
    # ("He broke up with me and I want to kill myself").
    return all(_clause_is_ordinary(_clause(window, position)) for position in anchors)


def _windows(text: str) -> list[str]:
    """Each sentence, then each adjacent pair ("I picked a date. Friday is when I end it")."""

    sentences = [sentence.strip() for sentence in _SENTENCE_BREAK.split(text) if sentence.strip()]
    return [*sentences, *(f"{first} {second}" for first, second in zip(sentences, sentences[1:], strict=False))]


def detect_crisis(text: str) -> CrisisDetection:
    """Return whether ``text`` states explicit crisis intent, and its category."""

    if not text or not text.strip():
        return NEGATIVE
    for window in _windows(_normalize(text)):
        impersonal = _IMPERSONAL_METHOD.search(window)
        if impersonal is not None and not _is_ordinary(window, "method", [impersonal.start()]):
            return CrisisDetection(positive=True, category="method")
        if not _FIRST_PERSON.search(window):
            continue
        score, category, anchors = _score(window)
        if score >= CRISIS_THRESHOLD and category is not None and not _is_ordinary(window, category, anchors):
            return CrisisDetection(positive=True, category=category)
    return NEGATIVE


__all__ = ["CRISIS_THRESHOLD", "MAX_DETECTOR_CHARS", "CrisisCategory", "CrisisDetection", "detect_crisis"]
