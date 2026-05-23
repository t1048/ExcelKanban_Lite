# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from typing import Any, Dict, List

from .task_store import TaskStore


def push_excel_update(window, store: TaskStore):
    payload = {
        "tasks": store.get_tasks(),
        "statuses": store.get_statuses(),
        "validations": store.get_validations(),
    }
    json_payload = json.dumps(payload, ensure_ascii=False)
    script = (
        "if (window.__kanban_receive_update) {"
        f" window.__kanban_receive_update({json_payload});"
        " }"
    )
    try:
        window.evaluate_js(script)
    except Exception as exc:  # pragma: no cover - depends on runtime
        print(f"[kanban] Failed to push update to frontend: {exc}")


class JsApi:
    def __init__(self, store: TaskStore):
        self.store = store

    def get_tasks(self) -> List[Dict[str, Any]]:
        return self.store.get_tasks()

    def get_statuses(self) -> List[str]:
        return self.store.get_statuses()

    def get_validations(self) -> Dict[str, List[str]]:
        return self.store.get_validations()

    def get_state_snapshot(self) -> Dict[str, Any]:
        return self.store.get_state_snapshot()

    def update_validations(self, payload: Any) -> Dict[str, Any]:
        data = json.loads(payload) if isinstance(payload, str) else payload
        self.store.set_validations(data or {})
        return {
            "ok": True,
            "validations": self.store.get_validations(),
            "statuses": self.store.get_statuses(),
        }

    def add_task(self, payload: Any) -> Dict[str, Any]:
        data = json.loads(payload) if isinstance(payload, str) else payload
        return self.store.add_task(data)

    def update_task(self, no_value: Any, patch: Any) -> Dict[str, Any]:
        patch_data = json.loads(patch) if isinstance(patch, str) else patch
        return self.store.update_task(int(no_value), patch_data)

    def move_task(self, no_value: Any, new_status: str) -> Dict[str, Any]:
        return self.store.move_task(int(no_value), new_status)

    def move_task_parent(self, no_value: Any, new_parent_id: str) -> Dict[str, Any]:
        return self.store.update_task(int(no_value), {"__parent_id": new_parent_id or ""})

    def delete_task(self, no_value: Any, cascade: bool = True) -> bool:
        return self.store.delete_task(int(no_value), cascade=cascade)

    def get_task_tree(self) -> list:
        return self.store.get_task_tree()

    def get_task_children(self, task_id: str) -> list:
        return self.store.get_children(task_id)

    def save_excel(self) -> str:
        return self.store.save_excel()

    def reload_from_excel(self) -> Dict[str, Any]:
        self.store.load_excel()
        return {
            "ok": True,
            "tasks": self.store.get_tasks(),
            "statuses": self.store.get_statuses(),
            "validations": self.store.get_validations(),
        }
