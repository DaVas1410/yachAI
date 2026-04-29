import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_admin, get_current_user, get_verified_token
from app.core.database import get_db
from app.models.chunk import Chunk
from app.models.user import User
from app.services.metrics import get_stats, set_feedback

router = APIRouter(prefix="/metrics", tags=["metrics"])


class FeedbackRequest(BaseModel):
    metric_id: uuid.UUID
    vote: str  # "up" | "down"


@router.get("/stats")
async def stats(
    _: dict = Depends(get_verified_token),
    db: AsyncSession = Depends(get_db),
):
    return await get_stats(db)


@router.post("/feedback")
async def feedback(
    body: FeedbackRequest,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.vote not in ("up", "down"):
        raise HTTPException(status_code=422, detail="El voto debe ser 'up' o 'down'.")
    ok = await set_feedback(db, body.metric_id, body.vote)
    if not ok:
        raise HTTPException(status_code=404, detail="Métrica no encontrada.")
    return {"ok": True}


@router.get("/embeddings")
async def embeddings(
    _: dict = Depends(get_verified_token),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Chunk.id, Chunk.umap_x, Chunk.umap_y, Chunk.umap_z, Chunk.document_id)
        .where(Chunk.umap_x.is_not(None))
    )
    rows = result.all()
    return [
        {
            "id": str(r.id),
            "x": r.umap_x,
            "y": r.umap_y,
            "z": r.umap_z,
            "document_id": str(r.document_id),
        }
        for r in rows
    ]
