"""Keep blocking inspection and its cleanup inside the request-owned lifetime."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from animama.app.ports.content_package_staging import PackageInspector, PackageStageLease
from animama.app.services.content_package_archive import InspectedPackage


@asynccontextmanager
async def inspect_package(inspector: PackageInspector, lease: PackageStageLease) -> AsyncIterator[InspectedPackage]:
    """Callers shield the complete operation, including exit and resource release."""
    context = inspector.inspect(lease)
    inspected = await asyncio.to_thread(context.__enter__)
    try:
        yield inspected
    except BaseException as exc:
        await asyncio.to_thread(context.__exit__, type(exc), exc, exc.__traceback__)
        raise
    else:
        await asyncio.to_thread(context.__exit__, None, None, None)
