# Anti-Hallucination & Sensitivity Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the RAG system prompt against hallucination, add a rerank-score gate that refuses out-of-context queries, and prepend an institutional support notice when sensitive topics (gender violence, harassment, mental health, discrimination) are detected.

**Architecture:** All backend logic lives in `backend/app/services/rag.py` — new module-level constants + two new functions (`_check_sensitivity`, updated `_build_prompt`) plus guard clauses in `stream_response`. The frontend adds one new WS event type (`notice`) and renders it as an amber card above the assistant bubble.

**Tech Stack:** Python 3.11, FastAPI, sentence-transformers (`BAAI/bge-reranker-base`), React 18 + TypeScript, shadcn/ui, lucide-react

---

## File Map

| Action | Path |
|--------|------|
| Modify | `backend/app/services/rag.py` |
| Create | `backend/tests/__init__.py` |
| Create | `backend/tests/test_rag.py` |
| Modify | `frontend/src/pages/ChatPage.tsx` |

---

## Task 1: Add pytest dev dependency

**Files:**
- Modify: `backend/pyproject.toml`

- [ ] **Step 1: Add pytest**

```bash
cd backend && uv add --dev pytest
```

Expected: `pyproject.toml` gains a `[dependency-groups]` dev section with `pytest`.

- [ ] **Step 2: Verify pytest runs**

```bash
cd backend && .venv/bin/pytest --version
```

Expected: prints `pytest X.Y.Z`

---

## Task 2: Write failing tests for `_check_sensitivity` and `_build_prompt`

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_rag.py`

- [ ] **Step 1: Create empty `__init__.py`**

Create `backend/tests/__init__.py` with no content (empty file).

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_rag.py`:

```python
import pytest
from app.services.rag import _check_sensitivity, _build_prompt, _SUPPORT_MESSAGE


# ── _check_sensitivity ──────────────────────────────────────────────────────

def test_sensitivity_gender_violence_detected():
    result = _check_sensitivity("mi pareja me golpea y no sé qué hacer")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_harassment_detected():
    result = _check_sensitivity("hay mucho acoso sexual en mi facultad")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_mental_health_detected():
    result = _check_sensitivity("ya no quiero vivir, no puedo más")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_discrimination_detected():
    result = _check_sensitivity("me discriminan por ser indígena")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_case_insensitive():
    result = _check_sensitivity("VIOLENCIA DE GÉNERO en el campus")
    assert result == _SUPPORT_MESSAGE

def test_sensitivity_clean_query_returns_none():
    result = _check_sensitivity("¿cuáles son los requisitos de graduación?")
    assert result is None

def test_sensitivity_institutional_query_returns_none():
    result = _check_sensitivity("¿cómo solicitar una beca estudiantil?")
    assert result is None


# ── _build_prompt ────────────────────────────────────────────────────────────

def test_build_prompt_system_forbids_invention():
    messages = _build_prompt("¿cuál es el artículo 3?", ["Artículo 3: texto de ejemplo."])
    system_content = messages[0]["content"]
    assert "No encontré información" in system_content
    assert "inventes" in system_content or "Nunca inventes" in system_content

def test_build_prompt_context_appears_in_user_message():
    messages = _build_prompt("pregunta", ["chunk de prueba"])
    user_content = messages[1]["content"]
    assert "chunk de prueba" in user_content
    assert "pregunta" in user_content

def test_build_prompt_returns_two_messages():
    messages = _build_prompt("test", ["ctx"])
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
```

- [ ] **Step 3: Run tests — expect ImportError (symbols don't exist yet)**

```bash
cd backend && .venv/bin/pytest tests/test_rag.py -v
```

Expected: `ImportError` or `cannot import name '_check_sensitivity'` — confirms tests are wired up correctly.

---

## Task 3: Implement sensitivity detection constants and function

**Files:**
- Modify: `backend/app/services/rag.py`

- [ ] **Step 1: Add module-level constants after the existing `TOP_K_RERANK = 5` line**

In `rag.py`, after line `TOP_K_RERANK = 5` (currently line 23), insert:

```python
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

- [ ] **Step 2: Add `_check_sensitivity` function after the constants, before `_get_reranker`**

```python
def _check_sensitivity(query: str) -> str | None:
    q = query.lower()
    for keywords in _SENSITIVE_KEYWORDS.values():
        if any(kw in q for kw in keywords):
            return _SUPPORT_MESSAGE
    return None
```

- [ ] **Step 3: Run sensitivity tests**

```bash
cd backend && .venv/bin/pytest tests/test_rag.py -v -k "sensitivity"
```

Expected: all 7 `test_sensitivity_*` tests PASS.

---

## Task 4: Tighten `_build_prompt` system prompt

**Files:**
- Modify: `backend/app/services/rag.py` (lines 103–114)

- [ ] **Step 1: Replace the `system` string in `_build_prompt`**

Current `_build_prompt` (lines 103–114):

```python
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
```

Replace with:

```python
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
```

- [ ] **Step 2: Run prompt tests**

```bash
cd backend && .venv/bin/pytest tests/test_rag.py -v -k "build_prompt"
```

Expected: all 3 `test_build_prompt_*` tests PASS.

- [ ] **Step 3: Run full test suite**

```bash
cd backend && .venv/bin/pytest tests/test_rag.py -v
```

Expected: all 10 tests PASS.

- [ ] **Step 4: Commit backend logic**

```bash
cd backend && git add app/services/rag.py tests/__init__.py tests/test_rag.py
git commit -m "feat: add anti-hallucination prompt + sensitivity detection"
```

---

## Task 5: Wire sensitivity check and rerank gate into `stream_response`

**Files:**
- Modify: `backend/app/services/rag.py` (lines 117–206)

- [ ] **Step 1: Add sensitivity check at the very start of `stream_response`**

At the top of `stream_response`, immediately after `t0 = time.perf_counter()` (currently line 121), insert:

```python
    notice = _check_sensitivity(query)
    if notice:
        yield {"type": "notice", "content": notice}
```

- [ ] **Step 2: Add rerank score gate after `_rerank` returns**

Currently around line 131–132:

```python
    ranked = await asyncio.to_thread(_rerank, query, candidates)
    top_chunks = [c for c, _ in ranked]
    top_score = float(ranked[0][1]) if ranked else None
```

After these three lines (before the `umap_coords` block), insert:

```python
    if top_score is None or top_score < MIN_RERANK_SCORE:
        yield {
            "type": "chunk",
            "text": "No encontré información sobre esto en los documentos institucionales disponibles.",
        }
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

- [ ] **Step 3: Verify the full test suite still passes**

```bash
cd backend && .venv/bin/pytest tests/test_rag.py -v
```

Expected: all 10 tests PASS (these changes don't affect the pure-function tests).

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/rag.py
git commit -m "feat: wire sensitivity notice and rerank gate into stream_response"
```

---

## Task 6: Frontend — notice event type and rendering

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Add `notice` to the `Message` interface**

Current interface (lines 36–42):

```typescript
interface Message {
  role: "user" | "assistant"
  content: string
  metric_id?: string
  feedback?: "up" | "down"
  sources?: Source[]
}
```

Replace with:

```typescript
interface Message {
  role: "user" | "assistant"
  content: string
  metric_id?: string
  feedback?: "up" | "down"
  sources?: Source[]
  notice?: string
}
```

- [ ] **Step 2: Add `HeartHandshakeIcon` to the lucide-react import**

Current import (lines 18–28):

```typescript
import {
  BarChart2Icon,
  BotIcon,
  Loader2Icon,
  SendIcon,
  ShieldIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
} from "lucide-react"
```

Replace with:

```typescript
import {
  BarChart2Icon,
  BotIcon,
  HeartHandshakeIcon,
  Loader2Icon,
  SendIcon,
  ShieldIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
} from "lucide-react"
```

- [ ] **Step 3: Add `notice` handler in the WS `onmessage` block**

Current `onmessage` handler ends with (lines 87–91):

```typescript
      } else if (data.type === "error") {
        setStreaming(false)
        toast.error(data.content ?? "Error al procesar la consulta.")
      }
```

Replace that closing block with:

```typescript
      } else if (data.type === "notice") {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), { ...last, notice: data.content }]
          }
          return [...prev, { role: "assistant", content: "", notice: data.content }]
        })
      } else if (data.type === "error") {
        setStreaming(false)
        toast.error(data.content ?? "Error al procesar la consulta.")
      }
```

- [ ] **Step 4: Render the notice card above the message bubble**

In the assistant message render block, the bubble currently starts at (around line 257):

```tsx
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 max-w-prose text-sm leading-relaxed whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-card ring-1 ring-foreground/8 text-foreground rounded-tl-sm"
                  )}
                >
                  {m.content}
                </div>
```

Insert a notice card **before** that `<div>`:

```tsx
                {m.role === "assistant" && m.notice && (
                  <div className="flex items-start gap-2 max-w-prose rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-100">
                    <HeartHandshakeIcon className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <span className="whitespace-pre-wrap leading-relaxed">{m.notice}</span>
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 max-w-prose text-sm leading-relaxed whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-card ring-1 ring-foreground/8 text-foreground rounded-tl-sm"
                  )}
                >
                  {m.content}
                </div>
```

- [ ] **Step 5: Build check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: `✓ built in X.XXs` — no TypeScript errors.

- [ ] **Step 6: Commit frontend changes**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat: render sensitivity notice card in chat UI"
```

---

## Task 7: Manual smoke test

- [ ] **Step 1: Start backend and frontend**

```bash
# Terminal 1
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Test rerank gate (out-of-context query)**

Open `http://localhost:5173` and send: `"¿cuál es la temperatura media de Urcuquí en julio?"`

Expected: The assistant bubble shows the refusal text — "No encontré información sobre esto en los documentos institucionales disponibles." — without calling Ollama.

- [ ] **Step 3: Test sensitivity notice**

Send: `"mi pareja me golpea, no sé qué hacer"`

Expected: An amber card with `HeartHandshakeIcon` appears above the assistant bubble containing the support contacts, followed by any relevant institutional content (or the refusal if no context matches).

- [ ] **Step 4: Test normal RAG flow still works**

Send: `"¿cuáles son los requisitos de graduación?"`

Expected: Normal streaming response with source chips. No amber card. No premature refusal.
