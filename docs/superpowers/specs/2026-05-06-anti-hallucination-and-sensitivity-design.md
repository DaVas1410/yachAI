# Anti-Hallucination Constraints & Sensitivity Layer — Design Spec

**Date:** 2026-05-06
**Scope:** Spec 2, items 3 and 4
**Files touched:** `backend/app/services/rag.py`, `frontend/src/pages/ChatPage.tsx`

---

## 1. Goals

1. **Anti-hallucination:** The model must only answer from retrieved context. If context is insufficient it must refuse clearly, not fabricate.
2. **Sensitivity layer:** Detect sensitive topics (gender violence, harassment, mental health, discrimination) and immediately surface institutional support contacts before running the normal RAG answer.

---

## 2. Architecture

Both changes live entirely in `backend/app/services/rag.py` plus a small frontend handler in `ChatPage.tsx`. No new models, no migrations, no new files.

### Updated request flow

```
query
  │
  ├─ _check_sensitivity(query)
  │     ├── match → yield {"type": "notice", "content": <support_message>}
  │     └── no match → continue silently
  │
  ├─ get_embedding + _retrieve + _rerank   (unchanged)
  │
  ├─ rerank score gate
  │     ├── top_score < MIN_RERANK_SCORE (0.05) → yield done{insufficient_context: true}, stop
  │     └── ok → continue
  │
  ├─ _build_prompt()  [tightened system prompt]
  │
  └─ Ollama stream → yield chunks → yield done{sources, metric_id, ...}
```

The `"notice"` event is a new WebSocket event type sent **before** any `"chunk"` events. The frontend renders it as a distinct card. The main RAG answer still streams normally after, letting the user also read any relevant institutional policy.

---

## 3. Anti-Hallucination

### 3.1 Rerank score gate

At the top of `rag.py`:

```python
MIN_RERANK_SCORE = 0.05
```

In `stream_response`, after `_rerank` returns and before calling Ollama:

```python
if top_score is None or top_score < MIN_RERANK_SCORE:
    yield {"type": "chunk", "text": "No encontré información sobre esto en los documentos institucionales disponibles."}
    yield {
        "type": "done",
        "metric_id": None,
        "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
        "sources": [],
        "chunks": [],
        "query_umap": None,
    }
    return
```

Sending a `"chunk"` first ensures the refusal text appears in the chat bubble naturally, without any special frontend handling. The existing `done` handler then clears the streaming state.

> **Rationale for 0.05:** With `BAAI/bge-reranker-base`, genuinely relevant Spanish legal passages score > 0.95. A threshold of 0.05 catches truly irrelevant queries without false-positives.

### 3.2 Tightened system prompt

Replace the current 4-line system prompt in `_build_prompt` with:

```
Eres un asistente universitario de Yachay Tech (UITEY), Ecuador.
Responde ÚNICAMENTE usando la información del contexto proporcionado a continuación.

Reglas estrictas:
1. Si la respuesta no está en el contexto, di exactamente: "No encontré información sobre esto en los documentos institucionales disponibles."
2. Nunca inventes artículos, fechas, nombres, porcentajes ni procedimientos que no aparezcan textualmente en el contexto.
3. No uses conocimiento general fuera del contexto. Si el contexto es insuficiente, aplica la regla 1.
4. Cita el contenido relevante con precisión. No parafrasees de forma que cambie el significado legal o normativo.
5. Si el contexto contiene información parcial, preséntala como tal e indica qué no encontraste.
```

---

## 4. Sensitivity Detection Layer

### 4.1 Keyword dictionary

A module-level dict in `rag.py`. Matching is case-insensitive and checks for substring presence in the query.

```python
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
        "discriminación", "discriminado", "discriminada",
        "racismo", "racista", "xenofobia", "xenófobo",
        "homofobia", "homofóbico", "transfobia", "transfóbico",
        "odio por ser", "me odian por", "me rechazan por",
        "insultos racistas", "insultos homofóbicos",
        "exclusión", "marginación", "trato desigual",
        "me tratan diferente", "prejuicio", "estigma",
        "aporofobia", "discapacitismo", "ableismo",
    ],
}
```

### 4.2 Detection function

```python
def _check_sensitivity(query: str) -> str | None:
    q = query.lower()
    for keywords in _SENSITIVE_KEYWORDS.values():
        if any(kw in q for kw in keywords):
            return _SUPPORT_MESSAGE
    return None
```

### 4.3 Support message constant

```python
_SUPPORT_MESSAGE = (
    "Este tema es importante y merece atención especializada. "
    "Si necesitas apoyo, puedes acudir a:\n\n"
    "• **Departamento de Bienestar Estudiantil de Yachay Tech** — [CONTACTO POR CONFIRMAR]\n"
    "• **Federaciones Estudiantiles de Yachay Tech** — [CONTACTO POR CONFIRMAR]\n"
    "• **Línea de ayuda en crisis (Ecuador):** 1800-4VIDAS (1800-48432)\n"
    "• **ECU 911** (emergencias): 911\n\n"
    "El asistente también buscará información institucional relevante a continuación."
)
```

> **Action required before deploy:** Replace the `[CONTACTO POR CONFIRMAR]` placeholders with the real phone numbers / emails / office locations for Bienestar Estudiantil and the student federations.

### 4.4 Integration in `stream_response`

At the very start of `stream_response`, before retrieval:

```python
notice = _check_sensitivity(query)
if notice:
    yield {"type": "notice", "content": notice}
```

---

## 5. Frontend — Notice Event Handler (`ChatPage.tsx`)

### 5.1 Message type extension

Add `notice?: string` to the `Message` interface.

### 5.2 WS handler

In the `onmessage` handler, add a branch:

```typescript
} else if (data.type === "notice") {
  setMessages((prev) => {
    const last = prev[prev.length - 1]
    if (last?.role === "assistant") {
      return [...prev.slice(0, -1), { ...last, notice: data.content }]
    }
    return [...prev, { role: "assistant", content: "", notice: data.content }]
  })
}
```

### 5.3 Notice card rendering

Above the message bubble in the assistant message render block, when `m.notice` is set:

```tsx
{m.role === "assistant" && m.notice && (
  <div className="flex items-start gap-2 max-w-prose rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
    <HeartHandshakeIcon className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
    <span className="whitespace-pre-wrap leading-relaxed">{m.notice}</span>
  </div>
)}
```

Import `HeartHandshakeIcon` from `lucide-react`.

---

## 6. Error Handling

- `_check_sensitivity` is pure string matching — it cannot throw. No error handling needed.
- The rerank gate returns a valid `done` event, so the frontend handles it gracefully with no streaming text.
- The tightened prompt does not change Ollama communication — existing error handling in `stream_response` covers network failures.

---

## 7. What Is Not In Scope

- Logging which sensitivity category was triggered (can be added to `query_metrics` later if needed)
- LLM-based or embedding-based sensitivity classification
- Language detection (assumes queries are Spanish; English keywords are not included)
- Modifying the rerank threshold at runtime via admin UI
