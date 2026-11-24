"""Boundaries of the ChatGPT plan session: OpenAI's sign-in service and the private session file."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from animama.domain.chatgpt_plan import ChatGPTPlanRecord

REJECTING_ERRORS = frozenset({"invalid_grant", "invalid_client", "unauthorized_client"})
"""OAuth error codes that refuse the grant itself; only these remove the tokens (R2.3)."""

REGISTRATION_ERRORS = frozenset({"invalid_client", "unauthorized_client"})
"""OAuth error codes that refuse the installation's registration, so the next sign-in registers again."""


class ChatGPTPlanIdentityError(Exception):
    """OpenAI's sign-in service refused or could not answer.

    ``rejected`` is True only when OpenAI answered with one of the OAuth codes in
    ``REJECTING_ERRORS`` (for example a revoked or expired refresh token), so
    the tokens must be dropped. Anything else, including a network failure, a
    rate limit, a server error or a page that is not OpenAI's JSON (a proxy or
    bot check), leaves them in place. ``code`` is a short, safe identifier,
    never response text.
    """

    def __init__(self, code: str, *, rejected: bool) -> None:
        super().__init__(code)
        self.code = code
        self.rejected = rejected


@dataclass(frozen=True, slots=True)
class AuthorizeRequest:
    """Inputs for the browser's authorization URL.

    ``client_id`` is None for the first sign-in, which registers the
    installation under ``host_id``. Hints help OpenAI pick a returning account.
    """

    client_id: str | None = field(repr=False)
    host_id: str
    redirect_uri: str
    state: str = field(repr=False)
    nonce: str = field(repr=False)
    code_challenge: str = field(repr=False)
    login_hint: str | None = field(default=None, repr=False)
    prompt_consent: bool = False


@dataclass(frozen=True, slots=True)
class TokenGrant:
    """A token endpoint answer. ``scopes`` is None when OpenAI did not say which it granted."""

    access_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    id_token: str | None = field(repr=False)
    expires_in: float
    earliest_refresh_at: float | None
    scopes: tuple[str, ...] | None


@dataclass(frozen=True, slots=True)
class IdentityClaims:
    """The validated ID token's account claims."""

    subject: str = field(repr=False)
    email: str | None = field(repr=False)


class ChatGPTPlanIdentityPort(Protocol):
    """OpenAI's sign-in service: authorization, token exchange, refresh, validation and revocation."""

    issuer: str
    """The issuer a sign-in return names in ``iss``; a return naming another is refused."""

    def authorize_url(self, request: AuthorizeRequest) -> str:
        """Return the URL the browser opens.

        It carries the attempt's state and the account's email, so callers never log it.
        """
        ...

    async def exchange_code(self, *, client_id: str, code: str, verifier: str, redirect_uri: str) -> TokenGrant: ...

    async def refresh(self, *, client_id: str, refresh_token: str) -> TokenGrant: ...

    async def validate_id_token(self, id_token: str, *, client_id: str, nonce: str | None) -> IdentityClaims:
        """Check signature, issuer, audience and expiry, and the nonce when one is given.

        A refreshed ID token carries no nonce, so refreshes pass None.
        """
        ...

    async def revoke(self, *, client_id: str, refresh_token: str) -> bool:
        """End the renewable session at OpenAI. True only when OpenAI confirmed it."""
        ...


class ChatGPTPlanSessionStorePort(Protocol):
    """The private session file."""

    def load(self) -> ChatGPTPlanRecord | None:
        """Return the saved record, or None when there is none or it cannot be read (which means signed out)."""
        ...

    def save(self, record: ChatGPTPlanRecord) -> None:
        """Replace the record atomically; a failed write leaves the previous one intact."""
        ...
