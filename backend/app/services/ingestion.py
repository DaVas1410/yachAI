import asyncio
import hashlib
import uuid
from typing import AsyncIterator

import httpx
import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from umap import UMAP

from app.core.config import settings
from app.models.chunk import Chunk
from app.models.document import Document
from app.services.ocr import extract_text

__all__ = ["ingest_file", "delete_document", "get_embedding", "recompute_umap"]

CHUNK_SIZE = 512
CHUNK_OVERLAP = 64

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", ".", "!", "?", ",", " "],
)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _embed(texts: list[str]) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{settings.ollama_base_url}/api/embed",
            json={"model": settings.embed_model, "input": texts},
        )
        resp.raise_for_status()
        data = resp.json()
        if "embeddings" not in data:
            raise ValueError(f"Respuesta inesperada del API de embeddings: {data}")
        return data["embeddings"]


async def _embed_one(text: str) -> list[float]:
    results = await _embed([text])
    return results[0]


async def recompute_umap(db: AsyncSession) -> None:
    # Advisory lock prevents concurrent UMAP updates from deadlocking each other.
    # pg_try_advisory_xact_lock returns false if another session holds the lock — we skip.
    lock_result = await db.execute(text("SELECT pg_try_advisory_xact_lock(12345678)"))
    if not lock_result.scalar():
        return

    result = await db.execute(
        select(Chunk.id, Chunk.embedding).where(Chunk.embedding.is_not(None))
    )
    rows = result.all()
    if len(rows) < 4:
        return

    ids = [r.id for r in rows]
    matrix = np.array([r.embedding for r in rows], dtype=np.float32)

    n_neighbors = min(15, len(rows) - 1)
    umap_model = UMAP(n_components=3, n_neighbors=n_neighbors, metric="cosine", random_state=42)
    coords = umap_model.fit_transform(matrix)

    for i, chunk_id in enumerate(ids):
        await db.execute(
            update(Chunk)
            .where(Chunk.id == chunk_id)
            .values(
                umap_x=float(coords[i, 0]),
                umap_y=float(coords[i, 1]),
                umap_z=float(coords[i, 2]),
            )
        )

    await db.commit()


async def ingest_file(
    db: AsyncSession,
    filename: str,
    file_bytes: bytes,
) -> Document:
    file_hash = _sha256(file_bytes)

    existing = await db.execute(
        select(Document).where(Document.file_hash == file_hash)
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"El archivo ya fue procesado: {filename}")

    doc = Document(filename=filename, file_hash=file_hash, status="pending")
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    try:
        pages = await asyncio.to_thread(extract_text, file_bytes)
        non_empty_pages = [(page_num, t) for page_num, t in enumerate(pages, 1) if t.strip()]

        if not non_empty_pages:
            raise ValueError("No se pudo extraer texto del archivo.")

        # Build flat list of (page_number, chunk_text) by splitting each page separately.
        page_chunks: list[tuple[int, str]] = []
        for page_num, page_text in non_empty_pages:
            for chunk_text in _splitter.split_text(page_text):
                page_chunks.append((page_num, chunk_text))

        if not page_chunks:
            raise ValueError("No se pudo extraer texto del archivo.")

        batch_size = 16
        chunks: list[Chunk] = []
        texts_only = [t for _, t in page_chunks]
        for i in range(0, len(texts_only), batch_size):
            batch = texts_only[i : i + batch_size]
            embeddings = await _embed(batch)
            if len(embeddings) != len(batch):
                raise ValueError(f"Conteo de embeddings no coincide: esperado {len(batch)}, recibido {len(embeddings)}")
            for j, (chunk_text, emb) in enumerate(zip(batch, embeddings)):
                page_num, _ = page_chunks[i + j]
                chunks.append(
                    Chunk(
                        document_id=doc.id,
                        chunk_index=i + j,
                        page_number=page_num,
                        content=chunk_text,
                        embedding=emb,
                    )
                )

        db.add_all(chunks)
        doc.page_count = len(pages)
        doc.status = "ingested"
        await db.commit()

    except Exception as exc:
        doc.status = "error"
        doc.error_msg = str(exc)
        await db.commit()
        raise

    return doc


async def delete_document(db: AsyncSession, document_id: uuid.UUID) -> bool:
    doc = await db.get(Document, document_id)
    if not doc:
        return False
    db.delete(doc)
    await db.commit()
    await recompute_umap(db)
    return True


async def get_embedding(text: str) -> list[float]:
    return await _embed_one(text)
