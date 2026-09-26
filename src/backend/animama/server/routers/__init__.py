from fastapi import APIRouter

from . import (
    anima,
    anima_creation,
    anima_loadouts,
    anima_runtime,
    archive,
    avatar,
    chats,
    content,
    elevenlabs,
    events,
    logs,
    memory_entries,
    memory_manager,
    model_provider,
    runtime_capabilities,
    runtime_context,
    safety,
    settings,
    typed_content,
    user_files,
    user_profiles,
)

router = APIRouter()


router.include_router(anima_creation.router)
router.include_router(anima.router)
router.include_router(anima_loadouts.router)
router.include_router(anima_runtime.router)
router.include_router(model_provider.router)
router.include_router(runtime_context.router)
router.include_router(runtime_capabilities.router)
router.include_router(safety.router)
router.include_router(avatar.router)
router.include_router(logs.router)
router.include_router(content.router)
router.include_router(typed_content.router)
router.include_router(chats.router)
router.include_router(elevenlabs.router)
router.include_router(events.router)
router.include_router(archive.router)
router.include_router(settings.router)
router.include_router(user_files.router)
router.include_router(user_profiles.router)
router.include_router(memory_entries.router)
router.include_router(memory_manager.router)

__all__ = ["router"]
