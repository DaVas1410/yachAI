import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.metric import QueryMetric


async def log_query(
    db: AsyncSession,
    *,
    query: str,
    latency_ms: float | None = None,
    retrieval_score: float | None = None,
    rerank_score: float | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    umap_qx: float | None = None,
    umap_qy: float | None = None,
    umap_qz: float | None = None,
) -> QueryMetric:
    metric = QueryMetric(
        query=query,
        latency_ms=latency_ms,
        retrieval_score=retrieval_score,
        rerank_score=rerank_score,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        umap_qx=umap_qx,
        umap_qy=umap_qy,
        umap_qz=umap_qz,
    )
    db.add(metric)
    await db.commit()
    await db.refresh(metric)
    return metric


async def set_feedback(db: AsyncSession, metric_id: uuid.UUID, feedback: str) -> bool:
    result = await db.get(QueryMetric, metric_id)
    if not result:
        return False
    result.feedback = feedback
    await db.commit()
    return True


async def get_stats(db: AsyncSession) -> dict:
    result = await db.execute(select(QueryMetric).order_by(QueryMetric.created_at.desc()).limit(500))
    rows = result.scalars().all()
    if not rows:
        return {"total_queries": 0, "avg_latency_ms": None, "avg_retrieval_score": None, "thumbs_up": 0, "thumbs_down": 0}

    latencies = [r.latency_ms for r in rows if r.latency_ms is not None]
    rerank_scores = [r.rerank_score for r in rows if r.rerank_score is not None]
    thumbs_up = sum(1 for r in rows if r.feedback == "up")
    thumbs_down = sum(1 for r in rows if r.feedback == "down")

    return {
        "total_queries": len(rows),
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else None,
        "avg_retrieval_score": round(sum(rerank_scores) / len(rerank_scores), 4) if rerank_scores else None,
        "thumbs_up": thumbs_up,
        "thumbs_down": thumbs_down,
        "recent": [
            {
                "id": str(r.id),
                "query": r.query[:120],
                "latency_ms": r.latency_ms,
                "rerank_score": r.rerank_score,
                "feedback": r.feedback,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows[:50]
        ],
    }
