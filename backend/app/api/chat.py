import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.database import AsyncSessionLocal
from app.services.rag import stream_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()

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

            try:
                async with AsyncSessionLocal() as db:
                    async for chunk in stream_response(db, query):
                        await websocket.send_json(chunk)
            except Exception:
                logger.exception("Error al procesar la consulta")
                await websocket.send_json({"type": "error", "content": "Error al procesar la consulta."})

    except WebSocketDisconnect:
        pass
