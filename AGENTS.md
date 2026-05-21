# AGENTS.md

## Architecture

- PyWebView desktop app that visualizes Excel rows as a Kanban board, list, timeline (gantt), and calendar.
- **Backend**: Python, recently refactored from monolithic `backend/backend.py` into a `backend/` package (`constants`, `excel_watcher`, `gui_dialog`, `js_api`, `main`, `task_store`, `utils`).
- **Frontend**: Vanilla HTML/JS/CSS. No bundler, no framework.
- `backend/__init__.py` re-exports all public APIs. `backend/backend.py` is a backward-compatible wrapper that injects the repo root into `sys.path` so `python backend/backend.py` still works.

## Entry Points

- **CLI**: `python backend/backend.py --excel ./data/task.xlsx --html ./frontend/pages/index.html`
- **Real startup logic**: `backend/main.py::main()` — argparse, Tkinter option dialog, webview window, watchdog bootstrap.
- **HTML pages** (open directly in browser for mock-data UI testing):
  - `frontend/pages/index.html` — Kanban
  - `frontend/pages/list.html` — List/table view
  - `frontend/pages/timeline.html` — Timeline/gantt view
  - `frontend/pages/calendar.html` — Calendar view

## Developer Commands

- **Run app**: `python backend/backend.py`
- **Install deps**: `pip install -r requirements.txt`
- **Tests**: `python -m pytest tests/`  
  ⚠️ **Do not use bare `pytest`** — it fails with `ModuleNotFoundError: No module named 'backend'`. Always invoke via `python -m pytest`.
- **Single test**: `python -m pytest tests/test_task_store_bootstrap.py::test_bootstrap_persists_ids_and_respects_local_changes -v`

## Key Files & Boundaries

| Area | File | Responsibility |
|------|------|--------------|
| Backend entry | `backend/main.py` | Argparse, webview window, watcher bootstrap |
| Excel I/O | `backend/task_store.py` | pandas/openpyxl read/write, hidden `__kanban_id` column, backup rotation |
| JS bridge | `backend/js_api.py` | PyWebView `js_api` methods exposed to frontend |
| File watcher | `backend/excel_watcher.py` | watchdog / polling observer for external Excel changes |
| Startup dialog | `backend/gui_dialog.py` | Tkinter GUI to pick Excel file and options |
| Shared frontend | `frontend/scripts/common.js` | Mock API, validation helpers, status colors, toast/loading UI |
| Shared modal | `frontend/scripts/modalHelper.js` | Task create/edit modal (used by calendar/timeline; **index.js still has its own**) |
| Excel sync UI | `frontend/scripts/excelSync.js` | Validation rule editing modal |

## Repo-Specific Quirks

- `backend/backend.py` must not import from `.main` at module level without `sys.path` manipulation — when run as `python backend/backend.py`, Python resolves `backend` to the file itself. The wrapper adds `repo_root` to `sys.path` before importing the package.
- `ExecOption.json` (launch options cache) is stored next to `backend/main.py`, i.e. inside the `backend/` directory.
- Excel **must** contain (or will auto-create) these columns: `ステータス`, `大分類`, `中分類`, `タスク`, `担当者`, `優先度`, `期限`, `備考`. A hidden meta column `__kanban_id` is used for stable row tracking across reloads.
- Backups are written next to the target Excel file: `{stem}.bak_YYYYMMDD_HHMMSS.xlsx`. Max 10 backups, rotated by mtime.
- Python 3.10+ required (`str \| None` annotations).
- `.kilo/package.json` is for the KiloCode editor plugin, not the app runtime.
- `ExcelKanban_Lite.bat` references a hard-coded Miniconda path and has encoding issues; treat as user-local helper, not a supported build script.
