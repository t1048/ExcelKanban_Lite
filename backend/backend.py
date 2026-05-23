# -*- coding: utf-8 -*-
"""Backward-compatible wrapper. Delegates to the backend package submodules."""
from __future__ import annotations

import sys
from pathlib import Path

# When this script is executed directly, 'backend' would resolve to this file
# instead of the package. Add the repo root to sys.path so the package import works.
_repo_root = Path(__file__).resolve().parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from backend import (  # noqa: F401
    DEFAULT_PRIORITY_LEVELS,
    DEFAULT_STATUSES,
    DEFAULT_VALIDATIONS,
    ExcelFileWatcher,
    HIDDEN_META_COLUMNS,
    JsApi,
    META_ID_COLUMN,
    PARENT_ID_COLUMN,
    TASK_COLUMNS,
    TaskStore,
    format_priority,
    from_iso_date_str,
    load_exec_options,
    normalize_priority,
    open_option_dialog,
    push_excel_update,
    sanitize_text_for_excel,
    save_exec_options,
    start_excel_watcher,
    to_iso_date_str,
)

if __name__ == "__main__":
    from backend.main import main
    main()
