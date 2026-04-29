import json
import uuid

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db, AsyncSessionLocal
from app.core.security import decode_token
from app.models.message import Message
from app.models.user import User
from app.services.rag import stream_response

router = APIRouter(prefix="/chat", tags=["chat"])


async def _authenticate_ws(token: str) -> uuid.UUID:
    try:
        payload = decode_token(token)
    except JWTError:
        raise WebSocketDisconnect(code=4001)
    if payload.get("admin"):
        raise WebSocketDisconnect(code=4003)
    return uuid.UUID(payload["sub"])


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()

    try:
        auth_msg = await websocket.receive_text()
        data = json.loads(auth_msg)
        user_id = await _authenticate_ws(data.get("token", ""))
    except (WebSocketDisconnect, KeyError, json.JSONDecodeError):
        await websocket.close(code=4001)
        return

    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if not user or not user.is_active:
            await websocket.close(code=4003)
            return

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
                    async for chunk in stream_response(db, query, user_id):
                        await websocket.send_json(chunk)
            except Exception:
                await websocket.send_json({"type": "error", "content": "Error al procesar la consulta."})

    except WebSocketDisconnect:
        pass


@router.get("/history")
async def history(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Message)
        .where(Message.user_id == user.id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = list(reversed(result.scalars().all()))
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]
