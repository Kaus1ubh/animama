"""Re-export of the shared request-principal resolver (``animama.product_http.principal``)."""

from __future__ import annotations

from animama.product_http.principal import RequestPrincipalResolver, principal_resolver

__all__ = ["RequestPrincipalResolver", "principal_resolver"]
