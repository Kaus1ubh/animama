"""Where a stored model key may be sent.

A key that an owner connection names goes only to its own address: a provider
key to its provider's HTTPS API, and a connection key to the origin saved with
it (the desktop vault records the origin when the key is entered, and a
self-hosted operator sets ``ANIMAMA_CONNECTION_<NAME>_ORIGIN`` beside the key).
No such key travels over plain HTTP unless the host is this computer. The
built-in OpenAI connection keeps the operator's ``OPENAI_BASE_URL``.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

_DEFAULT_PORTS = {"http": 80, "https": 443}


def canonical_origin(value: str | None) -> str | None:
    """Return ``scheme://host[:port]`` of an absolute HTTP(S) URL, or ``None``.

    The scheme and host are lowercased, an IPv6 address takes its standard form
    and a default port is dropped, so two spellings of one origin compare
    equal. A URL whose authority has any user information (even an empty
    ``@``), a character outside ASCII, a ``%`` (percent-encoding or an IPv6
    zone) or anything other than an IPv6 address in brackets returns ``None``,
    so no key matches it: write a non-ASCII name in its ASCII (``xn--``) form,
    as browsers and the model clients' HTTP library send it. A browser also
    rewrites a few rare ASCII spellings (such as ``127.1``); those stay as
    written and never match.
    """

    try:
        parts = urlsplit((value or "").strip())
        port = parts.port
    except ValueError:
        return None
    if not parts.netloc.isascii() or "@" in parts.netloc or "%" in parts.netloc:
        return None
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    if scheme not in _DEFAULT_PORTS or not host:
        return None
    if parts.netloc.startswith("["):
        try:
            host = f"[{ipaddress.IPv6Address(host).compressed}]"
        except ValueError:
            return None
    suffix = "" if port in (None, _DEFAULT_PORTS[scheme]) else f":{port}"
    return f"{scheme}://{host}{suffix}"


def is_origin(value: str) -> bool:
    """Return whether ``value`` is a bare ``scheme://host[:port]`` HTTP(S) origin.

    Deliveries accept any such origin with a host :func:`canonical_origin`
    accepts; one that matches no connection's address leaves only its own key
    unused.
    """

    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return (
        value.isascii()
        and value == value.strip()
        and canonical_origin(value) is not None
        and value == f"{parts.scheme}://{parts.netloc}"
    )


def is_this_computer(origin: str) -> bool:
    """Return whether a canonical origin's host is a loopback name or address, or Docker's host alias.

    These are the hosts the connection form also treats as this computer.
    """

    host = (urlsplit(origin).hostname or "").lower()
    if host in {"localhost", "host.docker.internal"} or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


__all__ = ["canonical_origin", "is_origin", "is_this_computer"]
