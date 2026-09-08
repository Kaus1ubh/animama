from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketException

from animama.logging_config import subscribe_logs, unsubscribe_logs
from animama.server.deps import resolve_websocket_principal

router = APIRouter()


@router.websocket("/v1/logs")
async def logs_socket(websocket: WebSocket) -> None:
    try:
        await resolve_websocket_principal(websocket)
    except WebSocketException as exc:
        await websocket.close(code=exc.code, reason=exc.reason)
        return
    await websocket.accept()
    q = await subscribe_logs(queue_size=1024)
    try:
        while True:
            item = await q.get()
            await websocket.send_text(json.dumps(item))
    except Exception:
        # Best-effort close
        try:
            await websocket.close()
        except Exception:
            pass
    finally:
        await unsubscribe_logs(q)
