from fastapi import APIRouter

from animama.product_http.routes import chats, memory, profile, settings

from . import (
    anima,
    anima_creation,
    anima_loadouts,
    anima_runtime,
    archive,
    avatar,
    content,
    content_packages,
    elevenlabs,
    events,
    logs,
    memory_manager,
    model_assets,
    model_provider,
    runtime_capabilities,
    runtime_context,
    safety,
    typed_content,
    user_files,
)

router = APIRouter()


router.include_router(anima_creation.router)
router.include_router(anima.router)
router.include_router(anima_loadouts.router)
router.include_router(anima_runtime.router)
router.include_router(model_provider.router)
router.include_router(model_assets.router)
router.include_router(runtime_context.router)
router.include_router(runtime_capabilities.router)
router.include_router(safety.router)
router.include_router(avatar.router)
router.include_router(logs.router)
router.include_router(content.router)
router.include_router(content_packages.router)
router.include_router(typed_content.router)
router.include_router(chats.router)
router.include_router(elevenlabs.router)
router.include_router(events.router)
router.include_router(archive.router)
router.include_router(settings.router)
router.include_router(user_files.router)
router.include_router(profile.router)
router.include_router(memory.router)
router.include_router(memory_manager.router)

__all__ = ["router"]
