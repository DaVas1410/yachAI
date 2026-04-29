import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_admin
from app.core.database import get_db
from app.models.chunk import Chunk
from app.models.document import Document
from app.models.user import User
from app.services.ingestion import delete_document, ingest_file, recompute_umap

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/upload")
async def upload_documents(
    files: list[UploadFile],
    _: dict = Depends(get_admin),
    db: AsyncSession = Depends(get_db),
):
    results = []
    for file in files:
        if not file.filename or not file.filename.lower().endswith(".pdf"):
            results.append({"filename": file.filename, "status": "error", "detail": "Solo se aceptan archivos PDF."})
            continue
        file_bytes = await file.read()
        if len(file_bytes) == 0:
            results.append({"filename": file.filename, "status": "error", "detail": "El archivo está vacío."})
            continue
        try:
            doc = await ingest_file(db, file.filename, file_bytes)
            results.append({"filename": doc.filename, "status": doc.status, "id": str(doc.id)})
        except ValueError as exc:
            results.append({"filename": file.filename, "status": "skipped", "detail": str(exc)})
        except Exception as exc:
            results.append({"filename": file.filename, "status": "error", "detail": str(exc)})

    uploaded = len([r for r in results if r.get("status") == "ingested"])
    if uploaded > 0:
        await recompute_umap(db)
    return {"uploaded": uploaded, "results": results}


@router.post("/ingest")
async def ingest_status(
    _: dict = Depends(get_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Document))
    docs = result.scalars().all()
    ingested = [d for d in docs if d.status == "ingested"]
    return {"processed": len(ingested), "total": len(docs)}


@router.get("/documents")
async def list_documents(
    _: dict = Depends(get_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document, func.count(Chunk.id).label("chunk_count"))
        .outerjoin(Chunk, Chunk.document_id == Document.id)
        .group_by(Document.id)
        .order_by(Document.uploaded_at.desc())
    )
    rows = result.all()
    return [
        {
            "id": str(row.Document.id),
            "filename": row.Document.filename,
            "chunk_count": row.chunk_count,
            "created_at": row.Document.uploaded_at.isoformat(),
            "status": row.Document.status,
            "error_msg": row.Document.error_msg,
        }
        for row in rows
    ]


@router.delete("/documents/{document_id}")
async def remove_document(
    document_id: uuid.UUID,
    _: dict = Depends(get_admin),
    db: AsyncSession = Depends(get_db),
):
    ok = await delete_document(db, document_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Documento no encontrado.")
    return {"ok": True}


@router.get("/users")
async def list_users(
    _: dict = Depends(get_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [
        {
            "id": str(u.id),
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.post("/users/{user_id}/toggle")
async def toggle_user(
    user_id: uuid.UUID,
    _: dict = Depends(get_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    user.is_active = not user.is_active
    await db.commit()
    return {"id": str(user.id), "is_active": user.is_active}
