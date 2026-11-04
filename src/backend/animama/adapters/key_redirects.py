"""Keep a key from following a provider's redirect to another origin.

httpx and httpx2 drop ``Authorization`` when they follow a redirect to another
origin, but keep custom key headers such as Anthropic's ``x-api-key``, Gemini's
``x-goog-api-key`` and ElevenLabs' ``xi-api-key``. Clients that send one of
those and follow redirects add these response hooks, which end the request
instead. A redirect within the same origin is still followed.
"""

from __future__ import annotations

import httpx
import httpx2

from animama.app.model_clients.key_origins import canonical_origin


class CrossOriginRedirectError(Exception):
    """A provider redirected a request that carries a key to another origin."""


def refuse_cross_origin_redirect(response: httpx.Response | httpx2.Response) -> None:
    """Response hook: raise instead of following a redirect to another origin.

    The error does not echo the redirect target, which the provider chose.
    """

    if not response.has_redirect_location:
        return
    target = response.url.join(response.headers["location"])
    if canonical_origin(str(target)) != canonical_origin(str(response.url)):
        raise CrossOriginRedirectError("The provider redirected the request to another address; it was not followed.")


async def refuse_cross_origin_redirect_async(response: httpx.Response | httpx2.Response) -> None:
    """The async clients' form of :func:`refuse_cross_origin_redirect`."""

    refuse_cross_origin_redirect(response)


__all__ = ["CrossOriginRedirectError", "refuse_cross_origin_redirect", "refuse_cross_origin_redirect_async"]
