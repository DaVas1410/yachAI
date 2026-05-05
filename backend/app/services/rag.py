import asyncio
import json
import logging
import time
from typing import AsyncIterator

import httpx
from sentence_transformers import CrossEncoder
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.chunk import Chunk
from app.services.ingestion import get_embedding

logger = logging.getLogger(__name__)

_reranker: CrossEncoder | None = None

TOP_K_RETRIEVE = 20
TOP_K_RERANK = 5


def _get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    return _reranker


async def _retrieve(db: AsyncSession, query_emb: list[float]) -> list[Chunk]:
    emb_str = "[" + ",".join(str(x) for x in query_emb) + "]"
    result = await db.execute(
        text(
            "SELECT id FROM chunks "
            "ORDER BY embedding <=> CAST(:emb AS vector) "
            "LIMIT :k"
        ),
        {"emb": emb_str, "k": TOP_K_RETRIEVE},
    )
    ids = [row[0] for row in result.all()]
    chunks = []
    for chunk_id in ids:
        chunk = await db.get(Chunk, chunk_id)
        if chunk:
            chunks.append(chunk)
    return chunks


def _rerank(query: str, chunks: list[Chunk]) -> list[tuple[Chunk, float]]:
    reranker = _get_reranker()
    pairs = [[query, c.content] for c in chunks]
    scores = reranker.predict(pairs)
    ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)
    return ranked[:TOP_K_RERANK]


def _build_prompt(query: str, context_chunks: list[str]) -> list[dict]:
    system = (
        "Eres un asistente universitario de Yachay Tech (UITEY), Ecuador. "
        "Responde únicamente en español usando la información del contexto proporcionado. "
        "Si la respuesta no está en el contexto, indícalo claramente. "
        "Sé preciso, formal y útil."
    )
    context_text = "\n\n---\n\n".join(context_chunks)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Contexto:\n{context_text}\n\nPregunta: {query}"},
    ]


async def stream_response(
    db: AsyncSession,
    query: str,
) -> AsyncIterator[dict]:
    t0 = time.perf_counter()

    query_emb = await get_embedding(query)
    candidates = await _retrieve(db, query_emb)

    if not candidates:
        yield {"type": "error", "content": "No encontré documentos relevantes para tu consulta."}
        return

    ranked = await asyncio.to_thread(_rerank, query, candidates)
    top_chunks = [c for c, _ in ranked]
    top_score = float(ranked[0][1]) if ranked else None

    umap_coords = None
    if top_chunks and top_chunks[0].umap_x is not None:
        umap_coords = {
            "x": top_chunks[0].umap_x,
            "y": top_chunks[0].umap_y,
            "z": top_chunks[0].umap_z,
        }

    messages = _build_prompt(query, [c.content for c in top_chunks])

    full_response = ""
    tokens_out = 0

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{settings.ollama_base_url}/api/chat",
                json={"model": settings.chat_model, "messages": messages, "stream": True},
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError as e:
                        logger.warning(f"JSON inválido recibido de Ollama: {e} — línea: {line[:100]}")
                        continue
                    token = data.get("message", {}).get("content", "")
                    if token:
                        full_response += token
                        tokens_out += 1
                        yield {"type": "chunk", "text": token}
                    if data.get("done"):
                        break
    except (httpx.RequestError, httpx.HTTPStatusError) as e:
        logger.error(f"Error de comunicación con Ollama: {e}")
        yield {"type": "error", "content": "Error al comunicarse con el modelo de lenguaje."}
        return

    latency_ms = (time.perf_counter() - t0) * 1000

    try:
        from app.services.metrics import log_query
        metric = await log_query(
            db,
            query=query,
            latency_ms=latency_ms,
            rerank_score=top_score,
            tokens_out=tokens_out,
            umap_qx=umap_coords["x"] if umap_coords else None,
            umap_qy=umap_coords["y"] if umap_coords else None,
            umap_qz=umap_coords["z"] if umap_coords else None,
        )
    except Exception as e:
        logger.error(f"Error al guardar métricas: {e}")
        yield {"type": "error", "content": "Error al guardar métricas."}
        return

    yield {
        "type": "done",
        "metric_id": str(metric.id),
        "latency_ms": round(latency_ms, 1),
        "chunks": [
            {
                "id": str(c.id),
                "umap_x": c.umap_x,
                "umap_y": c.umap_y,
                "umap_z": c.umap_z,
            }
            for c in top_chunks
        ],
        "query_umap": umap_coords,
    }
