# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

yachAI is a RAG-based chatbot for Yachay Tech University (UITEY, Ecuador). It lets students, staff, and the public query institutional documents (regulations, procedures, policies) in Spanish. The `data/` folder contains the source PDFs — scanned and digital — in Spanish.

## Architecture

```
Frontend (React + Vite + shadcn/ui + Tailwind + Three.js)
    ├── /chat        — per-user chatbot with persistent history
    ├── /metrics     — RAG metrics dashboard + 3D embedding visualization
    └── /admin       — document ingestion, user management (hardcoded credentials)

Backend (FastAPI + Python)
    ├── api/auth     — JWT register/login (users self-register; admin via .env creds)
    ├── api/chat     — WebSocket streaming chat, history retrieval
    ├── api/admin    — upload PDFs, trigger ingestion, delete docs, list users
    └── api/metrics  — query stats, latency, feedback, UMAP embedding coords

Services
    ├── ocr.py       — pymupdf (digital PDFs) → pytesseract/spa (scanned PDFs)
    ├── ingestion.py — chunk → embed → pgvector (incremental: SHA-256 hash skip)
    ├── rag.py       — retrieve → cross-encoder rerank → qwen2.5:7b generate
    └── metrics.py   — log latency, scores, tokens, thumbs feedback

Data Layer (Docker)
    └── PostgreSQL + pgvector
        ├── users, sessions
        ├── documents, chunks (+ vector column)
        ├── messages (per-user conversation history)
        └── query_metrics

Ollama (local, GPU)
    ├── qwen2.5:7b      — Spanish chat generation
    └── nomic-embed-text — chunk + query embeddings

HuggingFace (CPU, ~90MB)
    └── cross-encoder/ms-marco-MiniLM-L-6-v2 — reranker
```

## Development Commands

### Start infrastructure
```bash
docker compose up -d          # PostgreSQL + pgAdmin
```

### Backend
```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows
pip install -r requirements.txt
alembic upgrade head          # run migrations
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # starts on http://localhost:5173
```

### Run a single backend test
```bash
cd backend
pytest tests/test_rag.py -v
```

### Trigger ingestion manually (dev)
```bash
cd backend
python -m app.services.ingestion --path ../data
```

## Key Implementation Details

**OCR pipeline**: `pymupdf` first extracts text from digital PDFs. If a page yields fewer than 50 characters, it is treated as scanned and sent through `OpenCV` (deskew + denoise) → `pytesseract` with `lang=spa`. Never re-OCR a file whose SHA-256 hash is already in the `documents` table.

**Chunking**: `RecursiveCharacterTextSplitter`, 512 tokens, 64-token overlap. Spanish punctuation is respected.

**RAG flow**: embed query with `nomic-embed-text` → pgvector cosine similarity top-20 → cross-encoder reranks to top-5 → inject into `qwen2.5:7b` prompt with conversation history (last 10 turns) → stream response via WebSocket.

**3D visualization**: on backend, UMAP reduces all chunk embeddings to 3D coordinates (stored in `chunks.umap_x/y/z`). A background job recomputes these after each ingestion. At query time, the query vector is also projected to 3D and returned alongside retrieved chunk coords so the frontend can animate the query point landing near its matches in Three.js.

**Incremental ingestion**: each uploaded file is SHA-256 hashed. Files already in `documents.file_hash` are skipped entirely. Deletion removes both the document row and all its chunk rows (cascades to pgvector entries).

**Auth**: JWT (HS256), 7-day access tokens. Admin credentials are `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env` — not stored in the DB.

**Hardware target (dev)**: RTX 3050 Ti Mobile 4GB VRAM + 16GB RAM. `qwen2.5:7b` Q4 will spill ~1-2 layers to RAM via Ollama; expected ~15-25 tok/s. `nomic-embed-text` and the cross-encoder run comfortably in remaining VRAM/RAM.

## Environment Variables (`.env`)
```
DATABASE_URL=postgresql+asyncpg://yachai:yachai@localhost:5432/yachai
OLLAMA_BASE_URL=http://localhost:11434
EMBED_MODEL=nomic-embed-text
CHAT_MODEL=qwen2.5:7b
JWT_SECRET=change-me
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
```

## Project Structure
```
yachAI/
├── backend/
│   ├── app/
│   │   ├── api/          # auth.py, chat.py, admin.py, metrics.py
│   │   ├── core/         # config.py, security.py, database.py
│   │   ├── models/       # user.py, document.py, chunk.py, message.py, metric.py
│   │   └── services/     # ocr.py, ingestion.py, rag.py, metrics.py
│   ├── migrations/       # Alembic
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/        # ChatPage, MetricsPage, AdminPage
│   │   ├── components/   # shadcn/ui wrappers + ThreeScene.tsx
│   │   ├── hooks/        # useChat, useMetrics, useAdmin
│   │   └── lib/          # api.ts (axios client), ws.ts (WebSocket)
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── data/                 # source PDFs (do not modify programmatically)
├── .env                  # never commit
└── CLAUDE.md
```

## Language

All chatbot responses, UI labels, error messages, and document processing must be in **Spanish only**.
