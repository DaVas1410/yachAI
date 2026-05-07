# Production Readiness for University Users — Design Spec

**Date:** 2026-05-07
**Status:** Approved
**Scope:** Spec 3 — rate limiting, source citations UI, suggested starter questions

---

## Goal

Make yachAI suitable for real university users (students, professors, administrative staff) accessing it online without supervision. Three additions: protect the backend from abuse, show which documents back each answer, and reduce the blank-page friction on first use.

---

## What Is Already Done (Spec 2)

- **Out-of-scope refusal:** The `MIN_RERANK_SCORE = 0.05` gate in `rag.py` already returns "No encontré información sobre esto en los documentos institucionales disponibles." for queries with no relevant institutional content. No changes needed.
- **Sensitivity layer:** Keyword detection for violence, harassment, mental health, and discrimination already yields a `notice` event before the RAG answer.
- **Anti-hallucination prompt:** System prompt already forbids fabrication and requires citing the context.

---

## Section 1: Rate Limiting

### Approach

In-memory IP-based limiter inside the WebSocket handler. No external dependency (no Redis, no slowapi). A module-level `dict[str, deque[float]]` maps IP → timestamps of recent requests. On each incoming message the handler checks whether the IP has sent more than 10 messages in the last 60 seconds.

### File: `backend/app/api/chat.py`

Add at module level:

```python
import time
from collections import deque, defaultdict

_RATE_LIMIT = 10        # max requests
_RATE_WINDOW = 60.0     # seconds

_ip_buckets: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(ip: str) -> bool:
    """Return True if the IP is within the rate limit, False if exceeded."""
    now = time.monotonic()
    bucket = _ip_buckets[ip]
    while bucket and bucket[0] < now - _RATE_WINDOW:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT:
        return False
    bucket.append(now)
    return True
```

In the WebSocket handler, extract the client IP and check before processing each query:

```python
@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    client_ip = websocket.client.host if websocket.client else "unknown"

    try:
        while True:
            raw = await websocket.receive_text()
            # ... JSON parse ...

            if not _check_rate_limit(client_ip):
                await websocket.send_json({
                    "type": "error",
                    "content": "Demasiadas consultas. Espera un momento antes de continuar."
                })
                continue

            # ... existing query handling ...
    except WebSocketDisconnect:
        pass
```

The connection is kept open on rate limit violation — only the individual message is rejected. This avoids penalising users who hit the limit and then wait.

### Scope

- Applied only to the `/chat/ws` endpoint (the only public, high-cost endpoint).
- Admin and metrics endpoints are already protected (JWT) or read-only.
- In-memory state resets on server restart — acceptable for a single Railway instance.

---

## Section 2: Source Citations

### Backend — `backend/app/services/rag.py`

The `done` event currently sends `chunks` with only `id` and UMAP coordinates. Extend it to include `filename` and `page_number` by loading the `document` relationship on each top chunk.

In `_retrieve`, use `selectinload` to eagerly load the document:

```python
from sqlalchemy.orm import selectinload

# Inside _retrieve, replace db.get(Chunk, chunk_id) with:
chunk = await db.get(Chunk, chunk_id, options=[selectinload(Chunk.document)])
```

In `stream_response`, extend the `done` yield:

```python
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
            "filename": c.document.filename if c.document else None,
            "page_number": c.page_number,
        }
        for c in top_chunks
    ],
    "query_umap": umap_coords,
}
```

### Frontend — `frontend/src/pages/ChatPage.tsx`

**Type extension:**

```typescript
interface Message {
  role: "user" | "assistant"
  content: string
  metric_id?: string
  notice?: string
  sources?: { filename: string; page: number | null }[]  // new
}
```

**Parse sources from the `done` event:**

In the `done` branch of the WebSocket `onmessage` handler, extract deduplicated sources:

```typescript
if (data.type === "done") {
  setStreaming(false)
  const rawChunks: { filename?: string; page_number?: number | null }[] =
    data.chunks ?? []
  const seen = new Set<string>()
  const sources = rawChunks
    .filter((c) => c.filename)
    .reduce<{ filename: string; page: number | null }[]>((acc, c) => {
      const key = `${c.filename}::${c.page_number ?? ""}`
      if (!seen.has(key)) {
        seen.add(key)
        acc.push({ filename: c.filename!, page: c.page_number ?? null })
      }
      return acc
    }, [])

  if (data.metric_id || sources.length > 0) {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          { ...last, metric_id: data.metric_id, sources },
        ]
      }
      return prev
    })
  }
}
```

**Render collapsible "Fuentes" section:**

Below the assistant message bubble, when `m.sources?.length > 0`:

```tsx
{m.role === "assistant" && m.sources && m.sources.length > 0 && (
  <Collapsible className="mt-1 max-w-prose">
    <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
      <FileTextIcon className="w-3.5 h-3.5" />
      Fuentes ({m.sources.length})
      <ChevronDownIcon className="w-3 h-3 transition-transform [[data-state=open]_&]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent className="mt-1.5 space-y-1">
      {m.sources.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileTextIcon className="w-3 h-3 shrink-0" />
          <span className="truncate">{s.filename}</span>
          {s.page !== null && (
            <span className="shrink-0 text-muted-foreground/60">· pág. {s.page}</span>
          )}
        </div>
      ))}
    </CollapsibleContent>
  </Collapsible>
)}
```

Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`, and `FileTextIcon`, `ChevronDownIcon` from `lucide-react`.

---

## Section 3: Suggested Starter Questions

### Approach

Frontend only. No backend changes. When `messages.length === 0`, render 4 clickable question cards above the input. Clicking a card sets the textarea value and immediately submits (calls the same `sendMessage` handler). The cards are replaced by the first message.

### File: `frontend/src/pages/ChatPage.tsx`

**Questions constant** (module level, outside the component):

```typescript
const STARTER_QUESTIONS = [
  "¿Cuáles son los requisitos para matricularme en el siguiente semestre?",
  "¿Qué dice el reglamento sobre pérdida de la calidad de estudiante?",
  "¿Cuál es el procedimiento para solicitar una beca?",
  "¿Cuáles son las funciones del Consejo Académico?",
] as const
```

**Render in the chat area** (above the input, when `messages.length === 0`):

```tsx
{messages.length === 0 && (
  <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 pb-4">
    <p className="text-sm text-muted-foreground">Ejemplos de preguntas:</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
      {STARTER_QUESTIONS.map((q) => (
        <button
          key={q}
          onClick={() => sendMessage(q)}
          className="text-left rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-card-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {q}
        </button>
      ))}
    </div>
  </div>
)}
```

`sendMessage` must accept an optional string argument to support programmatic submission. If it currently only reads from the textarea state, update the signature to:

```typescript
function sendMessage(overrideText?: string) {
  const text = (overrideText ?? inputValue).trim()
  if (!text || streaming) return
  setInputValue("")
  // ... rest unchanged ...
}
```

---

## What Is Not In Scope

- Role selector (estudiante / docente / personal administrativo) — YAGNI for v1
- Dynamic suggested questions from `query_metrics` — needs usage data to be useful
- Confidence score display — rerank scores are internal; surface them only if user research shows need
- Redis-backed rate limiting — single Railway instance makes in-memory sufficient
- Filling `[CONTACTO POR CONFIRMAR]` placeholders in `_SUPPORT_MESSAGE` — required before production but tracked separately

---

## Files Changed

**Backend:**
- `backend/app/api/chat.py` — add IP rate limiter

**Backend:**
- `backend/app/services/rag.py` — add `filename` + `page_number` to `done` chunks

**Frontend:**
- `frontend/src/pages/ChatPage.tsx` — citations collapsible, starter questions, `sendMessage` override
