# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Dict, List

TASK_COLUMNS = [
    "ステータス",
    "大分類",
    "中分類",
    "タスク",
    "担当者",
    "優先度",
    "期限",
    "備考",
]
META_ID_COLUMN = "__kanban_id"
HIDDEN_META_COLUMNS = [META_ID_COLUMN]
DEFAULT_STATUSES = ["未着手", "進行中", "完了", "保留"]
DEFAULT_PRIORITY_LEVELS = ["高", "中", "低"]
DEFAULT_VALIDATIONS: Dict[str, List[str]] = {
    "ステータス": list(DEFAULT_STATUSES),
    "優先度": list(DEFAULT_PRIORITY_LEVELS),
}
