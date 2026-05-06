# Cloud Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy yachAI to Vercel (frontend) + Railway (backend) + Supabase (DB) + Groq (LLM), replacing Ollama entirely.

**Architecture:** sentence-transformers `paraphrase-multilingual-mpnet-base-v2` replaces nomic-embed-text for embeddings (same 768-dim, no schema change). Groq async streaming replaces httpx→Ollama for generation. All URLs become env vars. Backend is containerized for Railway.

**Tech Stack:** groq SDK, sentence-transformers (already installed), Vite env vars, Docker, Supabase pgvector, Railway, Vercel.

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `backend/app/services/ingestion.py` | Modify | Replace `_embed()` httpx→Ollama with sentence-transformers |
| `backend/app/services/rag.py` | Modify | Replace httpx→Ollama chat with Groq async streaming |
| `backend/app/core/config.py` | Modify | Remove Ollama vars; add `groq_api_key`, `groq_model`, `allowed_origins` |
| `backend/app/main.py` | Modify | CORS reads `settings.allowed_origins` |
| `backend/pyproject.toml` | Modify | Add `groq` dependency |
| `backend/Dockerfile` | Create | Production container (Ubuntu, tesseract, model pre-download) |
| `backend/railway.toml` | Create | Railway deploy config |
| `backend/.env.example` | Create | Document all required env vars |
| `backend/tests/test_rag.py` | Modify | Add embedding and Groq streaming tests |
| `frontend/src/lib/api.ts` | Modify | Use `VITE_API_URL` env var |
| `frontend/src/pages/ChatPage.tsx` | Modify | Use `VITE_WS_URL` env var |
| `frontend/.env.example` | Create | Document frontend env vars |
| `frontend/.env.local` | Create | Local dev values (gitignored) |

---

## Task 1: Replace embeddings with sentence-transformers

**Files:**
- Modify: `backend/app/services/ingestion.py`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_rag.py`:

```python
from unittest.mock import MagicMock, patch
import numpy as np
import pytest

@pytest.mark.asyncio
async def test_get_embedding_returns_768_dims():
    mock_model = MagicMock()
    mock_model.encode.return_value = np.random.rand(1, 768).astype(np.float32)
    with patch("app.services.ingestion._get_embed_model", return_value=mock_model):
        from app.services.ingestion import get_embedding
        result = await get_embedding("reglamento de evaluaciones")
    assert len(result) == 768
    assert all(isinstance(x, float) for x in result)
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pytest tests/test_rag.py::test_get_embedding_returns_768_dims -v
```

Expected: FAIL — `_get_embed_model` not defined.

- [ ] **Step 3: Replace the embedding implementation in `ingestion.py`**

Replace the entire block from `import httpx` through `async def get_embedding(text: str) -> list[float]:` (lines 7 and 34–49, 165–166) with the following. The rest of the file stays unchanged.

Replace these imports at the top:
```python
# REMOVE this line:
import httpx
```

Replace the `_embed` / `_embed_one` / `get_embedding` functions (currently lines 34–49 and 165–166) with:

```python
from sentence_transformers import SentenceTransformer

_embed_model: SentenceTransformer | None = None


def _get_embed_model() -> SentenceTransformer:
    global _embed_model
    if _embed_model is None:
        _embed_model = SentenceTransformer("paraphrase-multilingual-mpnet-base-v2")
    return _embed_model


def _embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_embed_model()
    vecs = model.encode(texts, normalize_embeddings=True)
    return vecs.tolist()


async def _embed(texts: list[str]) -> list[list[float]]:
    return await asyncio.to_thread(_embed_texts, texts)


async def _embed_one(text: str) -> list[float]:
    results = await _embed([text])
    return results[0]
```

And at the bottom, replace:
```python
async def get_embedding(text: str) -> list[float]:
    return await _embed_one(text)
```
(this line stays exactly the same — no change needed here)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_rag.py::test_get_embedding_returns_768_dims -v
```

Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd backend && pytest tests/test_rag.py -v
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ingestion.py backend/tests/test_rag.py
git commit -m "feat: replace nomic-embed-text/Ollama with sentence-transformers multilingual embeddings"
```

---

## Task 2: Add Groq dependency and update config

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Add groq to pyproject.toml**

In `backend/pyproject.toml`, add `groq>=0.9.0` to the dependencies list:

```toml
dependencies = [
    "alembic>=1.18.4",
    "asyncpg>=0.31.0",
    "bcrypt>=5.0.0",
    "fastapi[standard]>=0.136.1",
    "groq>=0.9.0",
    "httpx>=0.28.1",
    "langchain-text-splitters>=1.1.2",
    "numpy>=2.4.4",
    "opencv-python-headless>=4.13.0.92",
    "pgvector>=0.4.2",
    "pydantic-settings>=2.14.0",
    "pymupdf>=1.27.2.3",
    "pytesseract>=0.3.13",
    "python-jose[cryptography]>=3.5.0",
    "python-multipart>=0.0.26",
    "sentence-transformers>=5.4.1",
    "sqlalchemy[asyncio]>=2.0.49",
    "umap-learn>=0.5.12",
]
```

- [ ] **Step 2: Install the dependency**

```bash
cd backend && uv sync
```

Expected: `groq` package installs successfully, `uv.lock` updates.

- [ ] **Step 3: Replace config.py**

Replace the entire contents of `backend/app/core/config.py`:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str
    groq_api_key: str
    groq_model: str = "llama-3.3-70b-versatile"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7
    admin_username: str
    admin_password: str
    allowed_origins: str = "http://localhost:5173"


settings = Settings()
```

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/uv.lock backend/app/core/config.py
git commit -m "feat: add groq dependency, replace Ollama config vars with Groq + allowed_origins"
```

---

## Task 3: Replace Ollama LLM streaming with Groq in rag.py

**Files:**
- Modify: `backend/app/services/rag.py`
- Test: `backend/tests/test_rag.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_rag.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch


async def _fake_groq_stream(tokens: list[str]):
    for t in tokens:
        chunk = MagicMock()
        chunk.choices = [MagicMock()]
        chunk.choices[0].delta.content = t
        yield chunk


@pytest.mark.asyncio
async def test_groq_streaming_yields_chunks():
    from app.services.rag import _stream_from_groq
    tokens = ["Hola", " mundo", ""]
    with patch("app.services.rag._get_groq") as mock_get_groq:
        mock_client = MagicMock()
        mock_client.chat.completions.create = AsyncMock(
            return_value=_fake_groq_stream(tokens)
        )
        mock_get_groq.return_value = mock_client
        results = []
        async for item in _stream_from_groq([{"role": "user", "content": "test"}]):
            results.append(item)
    assert results == ["Hola", " mundo"]
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd backend && pytest tests/test_rag.py::test_groq_streaming_yields_chunks -v
```

Expected: FAIL — `_stream_from_groq` not defined.

- [ ] **Step 3: Replace the Ollama streaming block in rag.py**

At the top of `backend/app/services/rag.py`, replace:
```python
import httpx
```
with:
```python
from groq import AsyncGroq
```

Keep the existing `from app.core.config import settings` import — `settings` is still needed for `groq_api_key` and `groq_model`.

After the `_get_reranker()` function, add the following at module level (outside any function):

```python
_groq_client: AsyncGroq | None = None


def _get_groq() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=settings.groq_api_key)
    return _groq_client


async def _stream_from_groq(messages: list[dict]) -> AsyncIterator[str]:
    client = _get_groq()
    stream = await client.chat.completions.create(
        model=settings.groq_model,
        messages=messages,
        stream=True,
        max_tokens=1024,
    )
    async for chunk in stream:
        token = chunk.choices[0].delta.content or ""
        if token:
            yield token
```

Then in `stream_response`, replace the entire `try: async with httpx.AsyncClient...` block (currently lines 239–264) with:

```python
    try:
        async for token in _stream_from_groq(messages):
            full_response += token
            tokens_out += 1
            yield {"type": "chunk", "text": token}
    except Exception as e:
        logger.error(f"Error al comunicarse con Groq: {e}")
        yield {"type": "error", "content": "Error al comunicarse con el modelo de lenguaje."}
        return
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && pytest tests/test_rag.py::test_groq_streaming_yields_chunks -v
```

Expected: PASS

- [ ] **Step 5: Run full suite**

```bash
cd backend && pytest tests/test_rag.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/rag.py backend/tests/test_rag.py
git commit -m "feat: replace Ollama LLM streaming with Groq async client"
```

---

## Task 4: Make CORS configurable in backend

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Update CORS middleware to use settings**

In `backend/app/main.py`, replace:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

with:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.allowed_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 2: Verify the backend still starts**

```bash
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000 &
sleep 3 && curl -s http://localhost:8000/health && kill %1
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: CORS allowed_origins from env var"
```

---

## Task 5: Make frontend URLs configurable

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/pages/ChatPage.tsx`
- Create: `frontend/.env.example`
- Create: `frontend/.env.local`

- [ ] **Step 1: Update api.ts to use VITE_API_URL**

Replace the entire content of `frontend/src/lib/api.ts`:

```typescript
import axios from "axios"

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000"

export const api = axios.create({ baseURL })

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token")
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})
```

- [ ] **Step 2: Update ChatPage.tsx to use VITE_WS_URL**

In `frontend/src/pages/ChatPage.tsx`, line 57, replace:

```typescript
    const ws = new WebSocket("ws://localhost:8000/chat/ws")
```

with:

```typescript
    const wsBase = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000"
    const ws = new WebSocket(`${wsBase}/chat/ws`)
```

- [ ] **Step 3: Create frontend/.env.example**

Create `frontend/.env.example`:

```
VITE_API_URL=https://your-railway-backend.up.railway.app
VITE_WS_URL=wss://your-railway-backend.up.railway.app
```

- [ ] **Step 4: Create frontend/.env.local for local dev**

Create `frontend/.env.local`:

```
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

Check that `.env.local` is already gitignored (Vite gitignores it by default). Verify:

```bash
grep ".env.local" /home/davas/Documents/yachAI/.gitignore || echo "not ignored — add it"
```

If not present, add it to `.gitignore`.

- [ ] **Step 5: Verify frontend builds without errors**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `dist/` directory created, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ChatPage.tsx frontend/.env.example
git commit -m "feat: externalize frontend API and WebSocket URLs to Vite env vars"
```

---

## Task 6: Create backend .env.example

**Files:**
- Create: `backend/.env.example`

- [ ] **Step 1: Create the file**

Create `backend/.env.example`:

```
# Database (use Supabase Transaction Mode pooler URL in production)
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/database

# Groq LLM (get free key at console.groq.com)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# JWT
JWT_SECRET=change-me-minimum-32-chars
JWT_ALGORITHM=HS256
JWT_EXPIRE_DAYS=7

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-strong-password

# CORS — comma-separated list of allowed frontend origins
ALLOWED_ORIGINS=http://localhost:5173
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "docs: add backend .env.example with all required vars"
```

---

## Task 7: Fill placeholder contacts in sensitivity message

**Files:**
- Modify: `backend/app/services/rag.py`

> **Manual step — requires real contact information from the university.**
> Replace both `[CONTACTO POR CONFIRMAR]` occurrences in `_SUPPORT_MESSAGE` with actual contact info (email, phone, office hours, or website).

- [ ] **Step 1: Update `_SUPPORT_MESSAGE` in rag.py**

Find lines 71–72 in `backend/app/services/rag.py`:
```python
    "• **Departamento de Bienestar Estudiantil de Yachay Tech** — [CONTACTO POR CONFIRMAR]\n"
    "• **Federaciones Estudiantiles de Yachay Tech** — [CONTACTO POR CONFIRMAR]\n"
```

Replace `[CONTACTO POR CONFIRMAR]` in each line with the real contact (e.g. `bienestar@yachaytech.edu.ec` or phone number).

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/rag.py
git commit -m "fix: fill real contact info in sensitivity support message"
```

---

## Task 8: Write production Dockerfile for backend

**Files:**
- Create: `backend/Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.11-slim

# System deps: tesseract for OCR, libgl1/libglib2 for opencv
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-spa \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# Install Python deps first (layer cache)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Pre-download ML models so first request doesn't time out
RUN uv run python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-mpnet-base-v2')"
RUN uv run python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-base')"

# Copy application code
COPY . .

EXPOSE 8000

CMD sh -c "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"
```

- [ ] **Step 2: Build the image locally to verify it works**

```bash
cd backend && docker build -t yachai-backend .
```

Expected: image builds successfully (may take 5–10 min for model downloads).

- [ ] **Step 3: Smoke-test the container locally**

You need a local `.env` with `GROQ_API_KEY` set. Run:

```bash
docker run --rm -p 8001:8000 \
  --env-file .env \
  -e PORT=8000 \
  yachai-backend &
sleep 5 && curl -s http://localhost:8001/health && docker stop $(docker ps -q --filter ancestor=yachai-backend)
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile
git commit -m "feat: production Dockerfile for Railway (tesseract + model pre-download)"
```

---

## Task 9: Configure Railway deploy

**Files:**
- Create: `backend/railway.toml`

> **Manual steps required:** Create a Railway account at railway.app, create a new project, and link your GitHub repo before running these steps.

- [ ] **Step 1: Create railway.toml**

Create `backend/railway.toml`:

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 60
restartPolicyType = "on_failure"
```

- [ ] **Step 2: Commit railway.toml**

```bash
git add backend/railway.toml
git commit -m "feat: add Railway deploy configuration"
```

- [ ] **Step 3: Configure Railway service (manual — in Railway dashboard)**

In Railway dashboard:
1. Create new project → Deploy from GitHub repo
2. Set **Root Directory** to `backend/`
3. Under **Variables**, add all vars from `backend/.env.example` with real values:
   - `DATABASE_URL` → Supabase connection string (get this in Task 10)
   - `GROQ_API_KEY` → from console.groq.com (free account)
   - `GROQ_MODEL` → `llama-3.3-70b-versatile`
   - `JWT_SECRET` → generate with: `python -c "import secrets; print(secrets.token_hex(32))"`
   - `ADMIN_USERNAME` → your admin username
   - `ADMIN_PASSWORD` → strong password
   - `ALLOWED_ORIGINS` → your Vercel URL (set after Task 11, e.g. `https://yachai.vercel.app`)
4. Deploy. Railway will build the Dockerfile and assign a public URL like `https://backend-production-xxxx.up.railway.app`.
5. Note this URL — you need it for Task 11.

---

## Task 10: Migrate database to Supabase

> **Manual steps only — no code changes.** Do this before or in parallel with Task 9.

- [ ] **Step 1: Create Supabase project (manual)**

1. Go to supabase.com → New project
2. Choose region closest to Ecuador (e.g. `us-east-1` or `sa-east-1`)
3. Set a strong database password — save it

- [ ] **Step 2: Enable pgvector extension (manual)**

In Supabase dashboard:
- Go to **Database → Extensions**
- Search for `vector` → Enable it

- [ ] **Step 3: Get the connection string (manual)**

In Supabase dashboard:
- Go to **Project Settings → Database → Connection string**
- Select **Transaction mode** (port 5432, not 6543)
- Copy the URI and replace `[YOUR-PASSWORD]` with your DB password
- Change the scheme from `postgresql://` to `postgresql+asyncpg://`

Result looks like:
```
postgresql+asyncpg://postgres.xxxx:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

- [ ] **Step 4: Run Alembic migrations against Supabase**

```bash
cd backend
DATABASE_URL="postgresql+asyncpg://postgres.xxxx:password@..." uv run alembic upgrade head
```

Expected: all migrations apply with no errors.

- [ ] **Step 5: Re-ingest all PDFs**

Since the embedding model changed, all existing vector data is invalid. Clear old chunks and re-ingest:

```bash
cd backend
DATABASE_URL="your-supabase-url" uv run python -c "
import asyncio
from app.core.database import AsyncSessionLocal
from sqlalchemy import text

async def clear():
    async with AsyncSessionLocal() as db:
        await db.execute(text('DELETE FROM chunks'))
        await db.execute(text('DELETE FROM documents'))
        await db.commit()
        print('Cleared')

asyncio.run(clear())
"
```

Then re-ingest via the admin panel once Railway backend is deployed and pointing at Supabase.

---

## Task 11: Deploy frontend to Vercel

> **Manual steps only — no code changes needed.**

- [ ] **Step 1: Create Vercel project (manual)**

1. Go to vercel.com → New project → Import GitHub repo
2. Set **Root Directory** to `frontend/`
3. Framework preset: **Vite** (auto-detected)

- [ ] **Step 2: Set Vercel environment variables (manual)**

In Vercel project settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `VITE_API_URL` | `https://your-railway-url.up.railway.app` |
| `VITE_WS_URL` | `wss://your-railway-url.up.railway.app` |

Note: Railway URLs are HTTPS/WSS by default — no extra config needed.

- [ ] **Step 3: Deploy (manual)**

Click **Deploy** in Vercel. Build runs `npm run build` automatically.

- [ ] **Step 4: Update ALLOWED_ORIGINS in Railway (manual)**

Once Vercel assigns your URL (e.g. `https://yachai.vercel.app`), go back to Railway → Variables → set:

```
ALLOWED_ORIGINS=https://yachai.vercel.app
```

Redeploy the Railway service.

- [ ] **Step 5: Smoke test the full stack**

Open your Vercel URL in a browser and verify:
- Chat page loads
- Sending a message connects via WebSocket (check browser DevTools → Network → WS)
- Response streams back
- Admin login works at `/admin`

---

## Done

All cloud infrastructure is live. To migrate to university servers later:

1. Replace `DATABASE_URL` with university PostgreSQL + pgvector
2. Replace `ALLOWED_ORIGINS` with university domain
3. Update frontend `VITE_API_URL` / `VITE_WS_URL` to university backend URL
4. Optionally run Ollama on the university server and swap Groq back for `qwen2.5:7b` if required
