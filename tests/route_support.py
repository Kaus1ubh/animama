"""Route tables as FastAPI serves them.

FastAPI 0.137+ keeps each included router as one nested entry in ``routes``, so
route-inventory tests read the expanded table instead.
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import BaseRoute


def served_routes(router: FastAPI | APIRouter) -> list[BaseRoute]:
    """Every route ``router`` serves, in matching order, with included routers expanded."""

    routes: list[BaseRoute] = []
    for context in iter_route_contexts(router.routes):
        if isinstance(context.original_route, APIRoute):
            # Original routes stand in for served ones only while includes add no prefix.
            assert context.path == context.original_route.path, context.path
        routes.append(context.original_route)
    return routes
