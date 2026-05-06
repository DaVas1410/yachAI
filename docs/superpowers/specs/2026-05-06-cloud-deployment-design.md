# Cloud Deployment Design — yachAI

**Date:** 2026-05-06
**Status:** Approved

## Goal

Deploy yachAI to a public cloud stack so it is accessible from the internet before migrating to university servers. The deployment must be free or near-free and support the full feature set including WebSocket streaming chat.

## Architecture

```
Vercel          → Frontend (React/Vite, static build)
Railway         → FastAPI backend + cross-encoder reranker (persistent server, Docker)
Supabase        → PostgreSQL 15 + pgvector (managed DB)
Groq API        → LLM generation (replaces qwen2.5:7b via Ollama)
nomic-embed-text → Embeddings still served via Ollama on Railway (or replaced later)
```

### Why this stack

- **Vercel**: zero-config Vite deployment, free tier covers the frontend entirely.
- **Railway**: supports Docker containers, persistent processes, and WebSockets — the two things Vercel cannot do. Free $5/month credit covers a small FastAPI service.
- **Supabase**: managed PostgreSQL with native pgvector support, free tier has 500MB storage. No schema changes needed — same Alembic migrations apply.
- **Groq**: free API, sub-second latency, Spanish-capable models (`llama-3.3-70b-versatile`). Replaces the Ollama HTTP call in `rag.py` with an OpenAI-compatible client call.

## Changes Required (in priority order)

### 1. Replace Ollama LLM with Groq
- **File:** `backend/app/services/rag.py`
- Replace the `httpx` streaming call to `ollama/api/generate` with `groq` SDK (OpenAI-compatible).
- Add `GROQ_API_KEY` to config and `.env`.
- Keep `nomic-embed-text` via Ollama for embeddings initially; Railway can run Ollama in CPU mode for embedding (no generation needed, CPU is fine for nomic-embed-text).
- Fallback: if Ollama for embeddings is too heavy for Railway free tier, replace with `BAAI/bge-m3` via sentence-transformers (same library as the reranker, already a dependency).

### 2. Migrate database to Supabase
- Change `DATABASE_URL` in `.env` to Supabase connection string (Transaction mode pooler, port 5432).
- Run `alembic upgrade head` against Supabase once.
- Enable `pgvector` extension in Supabase dashboard (Settings → Extensions).

### 3. Make all URLs environment-configurable
- **Frontend:** replace hardcoded `ws://localhost:8000` and API base URL with Vite env vars (`VITE_API_URL`, `VITE_WS_URL`).
- **Backend:** CORS `allow_origins` must read from `ALLOWED_ORIGINS` env var (comma-separated list).

### 4. Dockerize backend for Railway
- Write production `Dockerfile` for backend (uvicorn, no --reload, proper system deps for tesseract + opencv).
- Write `railway.toml` or use Railway's auto-detect.
- Add `PORT` env var support (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`).

### 5. Deploy frontend to Vercel
- Set `VITE_API_URL` and `VITE_WS_URL` to Railway backend URL in Vercel env vars.
- `npm run build` → `dist/` served by Vercel automatically.

### 6. Fill placeholder contacts
- Replace `[CONTACTO POR CONFIRMAR]` in `rag.py` `_SUPPORT_MESSAGE` with real Bienestar Estudiantil and Federaciones Estudiantiles contacts.

## What is NOT in scope for this spec

- Rate limiting (follow-up spec)
- Student user accounts / auth (follow-up spec)
- Nginx reverse proxy (only needed for university server migration)
- DB backups (Supabase handles this automatically on managed tier)
- pgAdmin (drop from docker-compose for production; Supabase dashboard replaces it)

## Environment Variables (production set)

| Variable | Where set | Notes |
|----------|-----------|-------|
| `DATABASE_URL` | Railway + local `.env` | Supabase pooler URL |
| `GROQ_API_KEY` | Railway | From console.groq.com |
| `OLLAMA_BASE_URL` | Railway | Points to Railway internal Ollama if used, else remove |
| `JWT_SECRET` | Railway | Strong random string |
| `ADMIN_USERNAME` | Railway | Real admin username |
| `ADMIN_PASSWORD` | Railway | Strong password |
| `ALLOWED_ORIGINS` | Railway | Vercel frontend URL |
| `VITE_API_URL` | Vercel | Railway backend HTTPS URL |
| `VITE_WS_URL` | Vercel | Railway backend WSS URL |

## Embedding strategy decision

Two options, decide before implementing:

**A) Keep nomic-embed-text via Ollama on Railway (CPU)**
- No code change for embedding
- Railway free tier may be tight on memory (~500MB for nomic-embed-text)
- Ingestion will be slow but acceptable

**B) Replace with sentence-transformers model (e.g., `paraphrase-multilingual-mpnet-base-v2`)**
- Same library already in use for the reranker
- No Ollama needed on Railway at all
- Requires re-ingesting all documents (re-embedding with new model)
- Better fit for Railway memory limits

Recommendation: **Option B** — removes Ollama dependency entirely from the cloud deployment, simplifies Railway setup, and the multilingual model handles Spanish well. Re-ingestion is a one-time cost.

## Success criteria

- Frontend accessible at a public Vercel URL
- Chat WebSocket connects and streams responses
- Admin panel can upload and ingest PDFs
- All environment variables externalized (no localhost in production code)
- Existing Alembic migrations apply cleanly to Supabase
