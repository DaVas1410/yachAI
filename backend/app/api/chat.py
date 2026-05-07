import json
import logging
import time
from collections import defaultdict, deque

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.database import AsyncSessionLocal
from app.services.rag import stream_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

_RATE_LIMIT = 10
_RATE_WINDOW = 60.0

_ip_buckets: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(ip: str) -> bool:
    now = time.monotonic()
    bucket = _ip_buckets[ip]
    while bucket and bucket[0] < now - _RATE_WINDOW:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT:
        return False
    bucket.append(now)
    return True


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    client_ip = websocket.client.host if websocket.client else "unknown"

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "content": "Formato de mensaje inválido."})
                continue

            query = msg.get("query", "").strip()

            if not query:
                await websocket.send_json({"type": "error", "content": "La consulta está vacía."})
                continue

            if not _check_rate_limit(client_ip):
                await websocket.send_json({
                    "type": "error",
                    "content": "Demasiadas consultas. Espera un momento antes de continuar.",
                })
                continue

            try:
                async with AsyncSessionLocal() as db:
                    async for chunk in stream_response(db, query):
                        await websocket.send_json(chunk)
            except Exception:
                logger.exception("Error al procesar la consulta")
                await websocket.send_json({"type": "error", "content": "Error al procesar la consulta."})

    except WebSocketDisconnect:
        pass
