import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class QueryMetric(Base):
    __tablename__ = "query_metrics"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    query: Mapped[str] = mapped_column(Text)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    retrieval_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rerank_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(String(8), nullable=True)  # up | down
    umap_qx: Mapped[float | None] = mapped_column(Float, nullable=True)
    umap_qy: Mapped[float | None] = mapped_column(Float, nullable=True)
    umap_qz: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
