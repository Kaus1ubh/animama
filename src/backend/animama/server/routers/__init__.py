from fastapi import APIRouter

from animama.product_http.routes import (
    anima_runtime,
    animas,
    avatars,
    chats,
    content as shared_content,
    elevenlabs as shared_elevenlabs,
    loadouts,
    memory,
    memory_manager,
    model_catalog,
    packages,
    profile,
    runtime_capabilities,
    safety,
    settings,
    typed_content,
    voice_catalogs,
)

from . import (
    anima,
    anima_creation,
    archive,
    content,
    elevenlabs,
    events,
    logs,
    model_assets,
    runtime_context,
    user_files,
)

router = APIRouter()


router.include_router(anima_creation.router)
router.include_router(animas.router)
router.include_router(voice_catalogs.router)
router.include_router(anima.router)
router.include_router(loadouts.router)
router.include_router(anima_runtime.router)
router.include_router(model_catalog.router)
router.include_router(model_assets.router)
router.include_router(runtime_context.router)
router.include_router(runtime_capabilities.router)
router.include_router(safety.router)
router.include_router(avatars.router)
router.include_router(logs.router)
router.include_router(shared_content.router)
router.include_router(content.router)
router.include_router(packages.router)
router.include_router(typed_content.router)
router.include_router(chats.router)
router.include_router(shared_elevenlabs.router)
router.include_router(elevenlabs.router)
router.include_router(events.router)
router.include_router(archive.router)
router.include_router(settings.router)
router.include_router(user_files.router)
router.include_router(profile.router)
router.include_router(memory.router)
router.include_router(memory_manager.router)

__all__ = ["router"]
