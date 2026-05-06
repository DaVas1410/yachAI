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
from app.models.document import Document
from app.services.ingestion import get_embedding

logger = logging.getLogger(__name__)

_reranker: CrossEncoder | None = None

TOP_K_RETRIEVE = 40
TOP_K_RERANK = 5

MIN_RERANK_SCORE = 0.05

_SENSITIVE_KEYWORDS: dict[str, list[str]] = {
    "violencia_genero": [
        "violencia de género", "violencia doméstica", "violencia sexual",
        "violencia intrafamiliar", "violencia psicológica", "violencia física",
        "abuso sexual", "abuso físico", "abuso emocional", "abuso de pareja",
        "maltrato", "maltrato físico", "maltrato psicológico",
        "feminicidio", "femicidio", "agresión sexual", "agresión de pareja",
        "golpes", "me golpea", "me golpeó", "me lastima", "me hiere",
        "pareja violenta", "relación abusiva", "control abusivo",
    ],
    "acoso": [
        "acoso", "hostigamiento", "acoso sexual", "acoso laboral",
        "acoso escolar", "acoso universitario", "bullying", "ciberbullying",
        "acoso en línea", "acoso digital", "acoso por redes",
        "tocamientos indebidos", "comentarios inapropiados",
        "insinuaciones sexuales", "proposiciones indecentes",
        "me acosan", "me acosaron", "ambiente hostil",
        "persecución", "intimidación", "amenazas", "chantaje",
    ],
    "salud_mental": [
        "suicidio", "suicidarme", "quitarme la vida", "no quiero vivir",
        "quiero morir", "quiero desaparecer", "pensamientos de muerte",
        "hacerme daño", "autolesión", "autolesionarme", "cortarme",
        "depresión", "depresión severa", "crisis emocional", "crisis de pánico",
        "ataque de pánico", "angustia", "desesperanza", "desesperación",
        "no puedo más", "ya no aguanto", "me siento solo", "me siento sola",
        "ansiedad severa", "trastorno emocional", "colapso emocional",
        "burnout", "agotamiento extremo", "pensamientos negativos",
        "me quiero rendir", "no vale la pena seguir",
    ],
    "discriminacion": [
        "discriminación", "discriminado", "discriminada", "discriminan", "discriminar",
        "racismo", "racista", "xenofobia", "xenófobo",
        "homofobia", "homofóbico", "transfobia", "transfóbico",
        "odio por ser", "me odian por", "me rechazan por",
        "insultos racistas", "insultos homofóbicos",
        "exclusión", "marginación", "trato desigual",
        "me tratan diferente", "prejuicio", "estigma",
        "aporofobia", "discapacitismo", "ableismo",
    ],
}

_SUPPORT_MESSAGE = (
    "Este tema es importante y merece atención especializada. "
    "Si necesitas apoyo, puedes acudir a:\n\n"
    "• **Departamento de Bienestar Estudiantil de Yachay Tech** — [CONTACTO POR CONFIRMAR]\n"
    "• **Federaciones Estudiantiles de Yachay Tech** — [CONTACTO POR CONFIRMAR]\n"
    "• **Línea de ayuda en crisis (Ecuador):** 1800-4VIDAS (1800-48432)\n"
    "• **ECU 911** (emergencias): 911\n\n"
    "El asistente también buscará información institucional relevante a continuación."
)


def _check_sensitivity(query: str) -> str | None:
    q = query.lower()
    for keywords in _SENSITIVE_KEYWORDS.values():
        if any(kw in q for kw in keywords):
            return _SUPPORT_MESSAGE
    return None


def _get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder("BAAI/bge-reranker-base")
    return _reranker


async def _retrieve(db: AsyncSession, query: str, query_emb: list[float]) -> list[Chunk]:
    emb_str = "[" + ",".join(str(x) for x in query_emb) + "]"

    vector_result = await db.execute(
        text(
            "SELECT id FROM chunks "
            "ORDER BY embedding <=> CAST(:emb AS vector) "
            "LIMIT :k"
        ),
        {"emb": emb_str, "k": TOP_K_RETRIEVE},
    )
    vector_ids = {row[0] for row in vector_result.all()}

    bm25_result = await db.execute(
        text(
            "SELECT id FROM chunks "
            "WHERE to_tsvector('spanish', content) @@ "
            "  to_tsquery('spanish', (SELECT string_agg(lexeme, ' | ') FROM unnest(to_tsvector('spanish', :q)))) "
            "ORDER BY ts_rank_cd("
            "  to_tsvector('spanish', content),"
            "  to_tsquery('spanish', (SELECT string_agg(lexeme, ' | ') FROM unnest(to_tsvector('spanish', :q))))"
            ") DESC "
            "LIMIT :k"
        ),
        {"q": query, "k": TOP_K_RETRIEVE},
    )
    bm25_ids = {row[0] for row in bm25_result.all()}

    # Document-level pass: find documents whose filenames match query terms, then
    # inject their best chunks by vector similarity. Helps OCR'd docs whose chunk
    # embeddings are too noisy to surface via normal retrieval.
    doc_result = await db.execute(
        text(
            "SELECT id FROM documents "
            "WHERE to_tsvector('spanish', filename) @@ "
            "  to_tsquery('spanish', (SELECT string_agg(lexeme, ' | ') FROM unnest(to_tsvector('spanish', :q)))) "
            "LIMIT 10"
        ),
        {"q": query},
    )
    matched_doc_ids = [row[0] for row in doc_result.all()]
    doc_chunk_ids: set = set()
    for doc_id in matched_doc_ids:
        per_doc_result = await db.execute(
            text(
                "SELECT id FROM chunks "
                "WHERE document_id = CAST(:doc_id AS uuid) "
                "ORDER BY embedding <=> CAST(:emb AS vector) "
                "LIMIT 8"
            ),
            {"doc_id": str(doc_id), "emb": emb_str},
        )
        doc_chunk_ids.update(row[0] for row in per_doc_result.all())

    combined_ids = list(vector_ids | bm25_ids | doc_chunk_ids)
    chunks = []
    for chunk_id in combined_ids:
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
        "Eres un asistente universitario de Yachay Tech (UITEY), Ecuador.\n"
        "Responde ÚNICAMENTE usando la información del contexto proporcionado a continuación.\n\n"
        "Reglas estrictas:\n"
        "1. Si la respuesta no está en el contexto, di exactamente: "
        "\"No encontré información sobre esto en los documentos institucionales disponibles.\"\n"
        "2. Nunca inventes artículos, fechas, nombres, porcentajes ni procedimientos que no "
        "aparezcan textualmente en el contexto.\n"
        "3. No uses conocimiento general fuera del contexto. Si el contexto es insuficiente, "
        "aplica la regla 1.\n"
        "4. Cita el contenido relevante con precisión. No parafrasees de forma que cambie el "
        "significado legal o normativo.\n"
        "5. Si el contexto contiene información parcial, preséntala como tal e indica qué no "
        "encontraste."
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
    candidates = await _retrieve(db, query, query_emb)

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
                json={"model": settings.chat_model, "messages": messages, "stream": True, "think": False},
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

    sources = []
    seen_sources: set[tuple] = set()
    for c in top_chunks:
        key = (c.document_id, c.page_number)
        if key in seen_sources:
            continue
        seen_sources.add(key)
        doc = await db.get(Document, c.document_id)
        sources.append({
            "filename": doc.filename if doc else "Documento desconocido",
            "page": c.page_number,
        })

    yield {
        "type": "done",
        "metric_id": str(metric.id),
        "latency_ms": round(latency_ms, 1),
        "sources": sources,
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
