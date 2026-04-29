# Linux Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the yachAI dev environment work correctly on Linux (Fedora) by fixing CLAUDE.md commands, adding system dependency instructions, and removing the erroneous `backend/backend/` nested scaffold.

**Architecture:** Three independent, non-code changes: docs update (CLAUDE.md), filesystem cleanup (remove empty nested dir). No logic changes, no tests needed — correctness is verified by inspection and by confirming the deleted tree is truly empty scaffolding.

**Tech Stack:** Bash, `uv` (Python package manager), Fedora `dnf`

---

### Task 1: Fix CLAUDE.md backend dev commands for Linux

**Files:**
- Modify: `CLAUDE.md` (Backend section, lines ~44–52)

- [ ] **Step 1: Replace Windows venv activation with Linux path**

In `CLAUDE.md`, find the Backend section. Replace:
```
python -m venv .venv
.venv/Scripts/activate        # Windows
pip install -r requirements.txt
```
With:
```
uv sync
source .venv/bin/activate
```

The full Backend block should read:
```markdown
### Backend
```bash
cd backend
uv sync
source .venv/bin/activate
alembic upgrade head          # run migrations
uvicorn app.main:app --reload --port 8000
```
```

- [ ] **Step 2: Verify the edit looks correct**

Open `CLAUDE.md` and confirm:
- No `Scripts/activate` anywhere in the file
- No bare `pip install -r requirements.txt` (uv manages deps via `pyproject.toml`)
- `source .venv/bin/activate` is present
- `uv sync` is present before activation

```bash
grep -n "Scripts\|pip install -r\|uv sync\|bin/activate" CLAUDE.md
```

Expected output (no `Scripts` line, two hits for uv/activate):
```
XX:uv sync
XX:source .venv/bin/activate
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update backend dev commands for Linux (uv sync, bin/activate)"
```

---

### Task 2: Add Fedora system dependencies section to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (add new section after "Start infrastructure")

- [ ] **Step 1: Add Fedora system dependencies section**

In `CLAUDE.md`, insert a new section **before** the "Start infrastructure" section. The new section:

```markdown
### System dependencies (Fedora/Linux)

Install once before running the backend:

```bash
sudo dnf install -y \
  tesseract \
  tesseract-langpack-spa \
  python3-opencv \
  mesa-libGL \
  mesa-libEGL
```

`mesa-libGL` and `mesa-libEGL` are required by `opencv-python-headless` at import time on Fedora. Without them, `import cv2` raises `libGL.so.1: cannot open shared object file`.
```

- [ ] **Step 2: Verify the section is present and correctly placed**

```bash
grep -n "dnf\|tesseract\|mesa\|System dep" CLAUDE.md
```

Expected: lines showing the dnf install block and section header.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Fedora system dependency instructions (tesseract, opencv, mesa)"
```

---

### Task 3: Delete the erroneous backend/backend/ nested directory

**Files:**
- Delete: `backend/backend/` (entire directory — only contains empty `__init__.py` files)

- [ ] **Step 1: Confirm the directory contains only empty scaffolding**

```bash
find backend/backend -type f
```

Expected output — only `__init__.py` files, nothing else:
```
backend/backend/app/__init__.py
backend/backend/app/api/__init__.py
backend/backend/app/core/__init__.py
backend/backend/app/models/__init__.py
backend/backend/app/services/__init__.py
```

If any `.py` file has non-empty content, **stop and investigate before deleting**.

```bash
find backend/backend -type f -name "*.py" -exec wc -l {} +
```

Expected: all files show `0` lines (or `1` for a blank line). If any show real content, do not proceed.

- [ ] **Step 2: Confirm real backend code lives in backend/app/, not backend/backend/app/**

```bash
ls backend/app/
```

Expected: `api/  core/  models/  services/  main.py` (or similar — the real application code).

- [ ] **Step 3: Delete the nested directory**

```bash
rm -rf backend/backend/
```

- [ ] **Step 4: Verify deletion and confirm real app still intact**

```bash
ls backend/
ls backend/app/
```

`backend/backend/` must not appear. `backend/app/` must still contain the real code.

- [ ] **Step 5: Update CLAUDE.md project structure to remove backend/backend/ reference**

Search `CLAUDE.md` for any mention of `backend/backend`:

```bash
grep -n "backend/backend" CLAUDE.md
```

If found, remove those lines. If not found, skip this step.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove erroneous backend/backend/ nested scaffold (empty __init__.py only)"
```
