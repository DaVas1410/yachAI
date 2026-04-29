# yachAI — Refactor & Roadmap Design
**Date:** 2026-04-26  
**Status:** Approved

## Overview

Four independent, sequentially prioritized specs. Each is independently shippable. Execution order: Linux → RAG Quality → Features → Visual + Production.

---

## Spec 1: Linux Refactor

### Scope
- Update `CLAUDE.md` dev commands: replace `.venv/Scripts/activate` → `.venv/bin/activate`; add `uv sync` as the install step
- Add Fedora system dependencies section: `sudo dnf install tesseract tesseract-langpack-spa python3-opencv` plus any `libGL`/`libEGL` libs required by `opencv-python-headless`
- Delete the erroneous `backend/backend/` nested directory (empty `__init__.py` scaffolding, wrong nesting, will confuse imports)

### Out of scope
Docker Compose, frontend, all service logic — no changes needed.

---

## Spec 2: RAG Quality

### 2a. Debug the error
Run the full stack on Linux, reproduce the error, identify root cause. Likely candidates: `tesseract` not on PATH, `ollama` not running, pgvector extension not initialized, asyncpg connection issue. Diagnostic-first — no fixes until the error is reproduced.

### 2b. Citations
- Retrieved chunks already carry `document_id` and chunk metadata in DB
- RAG service returns a `sources` field with the top-5 reranked chunks: `[{filename, page_number, excerpt}]`
- WebSocket `done` event carries `sources` alongside `metric_id`
- Frontend renders a collapsible "Fuentes" section below each assistant message

### 2c. Anti-hallucination prompt constraints
- System prompt gets an explicit Spanish-language constraint: if retrieved context is insufficient, the model states so rather than speculating
- Confidence gate: if the top reranked chunk score is below a defined threshold, inject a low-confidence warning into the prompt before generation

### 2d. Ethics/sensitivity layer
- A keyword + semantic classifier runs on every query before RAG
- Trigger topics: gender violence, harassment, discrimination, sexual violence, procedimientos de denuncia
- On trigger, two things happen:
  - System prompt is augmented with a sensitivity block: respond with empathy, cite official procedures only, include Dirección de Bienestar Estudiantil contact
  - WebSocket `done` event carries `sensitive: true` flag
- Frontend renders a discreet amber support banner alongside the response when `sensitive: true`
- No queries are blocked — inform and support, never silence

---

## Spec 3: New Features

### 3a. Multi-session sidebar (priority 1)
- `messages` table gains `session_id` FK; new `sessions` table with `id, user_id, name, created_at, updated_at`
- Chat page gains a left sidebar: session list with name + relative timestamp, new session button
- Clicking a session loads its history via existing `/chat/history` endpoint extended with `?session_id=`
- On mobile, sidebar collapses to a slide-in drawer

### 3b. Source viewer (priority 2)
- Citations from Spec 2b become clickable
- Clicking opens a right-side panel (modal on mobile): document name, page number, raw extracted text excerpt
- No PDF rendering — text chunks only, no large file serving required

### 3c. Admin analytics (priority 3)
- New aggregations on existing `query_metrics` table (no new models):
  - Per-user query counts
  - Average response latency over time (chart)
  - Thumbs up/down ratio trend (chart)
  - CSV export of raw metrics
- New backend endpoints under `/metrics/admin`

---

## Spec 4: Visual Redesign + Production

### Visual redesign
**Direction:** Academic + warm — institutional authority, student-friendly approachability.

**Color palette:**
- Primary: deep forest green (`~#1B4332`)
- Background: warm off-white (not pure white)
- Accent: amber/gold for interactive elements
- Sensitive banner: warm amber card

**Typography:** Geist (already installed), structured heading weights. No changes to font stack.

**Auth page:**
- Remove decorative circles; replace with subtle topographic/grid pattern referencing academic maps
- Left panel becomes editorial: large headline, less decorative geometry, university portal feel

**Chat page:**
- Assistant message bubble: subtle left border accent instead of ring
- Empty state: replace generic SparklesIcon hero with a stylized document/book icon specific to UITEY context
- Suggestion chips: warmer card style
- Sensitive query: amber support banner with Bienestar Estudiantil contact below the response

### Production hardening
- Wire existing backend `Dockerfile` into `docker-compose.yml`
- Add Nginx service: serves frontend static build, reverse-proxies `/api` and `/chat/ws` to backend
- Add `healthcheck` to DB service so backend container waits for it on startup
- Commit `.env.example` (no secrets); add `.env` to `.gitignore`
- Goal: single `docker compose up` brings the entire stack up

---

## Execution Order

| # | Spec | Depends on |
|---|------|------------|
| 1 | Linux Refactor | — |
| 2 | RAG Quality | Spec 1 (stack must run) |
| 3 | Features | Spec 2 (citations needed for source viewer) |
| 4 | Visual + Production | Spec 3 (all features present before final polish) |
