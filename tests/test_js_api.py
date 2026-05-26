# -*- coding: utf-8 -*-
import datetime as dt
import json
from pathlib import Path

import pytest

pytest.importorskip("openpyxl")

from openpyxl import Workbook

from backend.backend import META_ID_COLUMN, PARENT_ID_COLUMN, TASK_COLUMNS, TaskStore
from backend.js_api import JsApi


def _build_workbook(path: Path, sheet_name: str = "Kanban") -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.delete_rows(1, ws.max_row)
    ws.append(TASK_COLUMNS)
    ws.append([
        "未着手", "タスクA", "Alice", "高",
        dt.date(2024, 1, 1), "最初のタスク",
    ])
    ws.append([
        "進行中", "タスクB", "Bob", "中",
        dt.date(2024, 1, 2), "二番目のタスク",
    ])
    wb.save(path)


@pytest.fixture
def api(tmp_path):
    excel_path = tmp_path / "board.xlsx"
    _build_workbook(excel_path)
    store = TaskStore(excel_path)
    return JsApi(store)


class TestJsApiDelegation:
    def test_get_tasks(self, api):
        tasks = api.get_tasks()
        assert len(tasks) == 2
        assert tasks[0]["タスク"] == "タスクA"

    def test_get_statuses(self, api):
        statuses = api.get_statuses()
        assert "未着手" in statuses
        assert "完了" in statuses

    def test_get_validations(self, api):
        validations = api.get_validations()
        assert "ステータス" in validations
        assert "優先度" in validations

    def test_get_state_snapshot(self, api):
        snap = api.get_state_snapshot()
        assert "tasks" in snap
        assert "statuses" in snap
        assert "validations" in snap

    def test_get_task_tree(self, api):
        tree = api.get_task_tree()
        assert len(tree) == 2

    def test_get_task_children(self, api):
        tasks = api.get_tasks()
        children = api.get_task_children(tasks[0]["__kanban_id"])
        assert children == []

    def test_save_excel(self, api):
        path = api.save_excel()
        assert path.endswith(".xlsx")

    def test_reload_from_excel(self, api):
        result = api.reload_from_excel()
        assert result["ok"] is True
        assert "tasks" in result
        assert "statuses" in result
        assert "validations" in result


class TestJsApiAddTask:
    def test_add_task_dict(self, api):
        result = api.add_task({"タスク": "新しいタスク"})
        assert result["タスク"] == "新しいタスク"
        assert "__kanban_id" in result

    def test_add_task_json_string(self, api):
        result = api.add_task(json.dumps({"タスク": "JSONタスク"}))
        assert result["タスク"] == "JSONタスク"

    def test_add_task_with_parent(self, api):
        parent_id = api.get_tasks()[0]["__kanban_id"]
        result = api.add_task({"タスク": "子タスク", "__parent_id": parent_id})
        assert result["__parent_id"] == parent_id

    def test_add_task_missing_title_raises(self, api):
        with pytest.raises(ValueError):
            api.add_task({"タスク": ""})


class TestJsApiUpdateTask:
    def test_update_task_dict(self, api):
        result = api.update_task(1, {"タスク": "更新タスク"})
        assert result["タスク"] == "更新タスク"

    def test_update_task_json_string(self, api):
        result = api.update_task(1, json.dumps({"タスク": "JSON更新"}))
        assert result["タスク"] == "JSON更新"

    def test_update_task_invalid_no_raises(self, api):
        with pytest.raises(KeyError):
            api.update_task(999, {"タスク": "更新"})


class TestJsApiMoveTask:
    def test_move_task(self, api):
        result = api.move_task(1, "完了")
        assert result["ステータス"] == "完了"

    def test_move_task_parent(self, api):
        tasks = api.get_tasks()
        child = api.add_task({"タスク": "子"})
        result = api.move_task_parent(child["No"], tasks[0]["__kanban_id"])
        assert result["__parent_id"] == tasks[0]["__kanban_id"]

    def test_move_task_parent_empty_clears(self, api):
        tasks = api.get_tasks()
        child = api.add_task({"タスク": "子", "__parent_id": tasks[0]["__kanban_id"]})
        result = api.move_task_parent(child["No"], "")
        assert result["__parent_id"] == ""


class TestJsApiDeleteTask:
    def test_delete_cascade_default(self, api):
        tasks = api.get_tasks()
        parent_id = tasks[0]["__kanban_id"]
        api.add_task({"タスク": "子", "__parent_id": parent_id})
        assert api.delete_task(1) is True
        assert len(api.get_tasks()) == 1

    def test_delete_without_cascade(self, api):
        tasks = api.get_tasks()
        parent_id = tasks[0]["__kanban_id"]
        api.add_task({"タスク": "子", "__parent_id": parent_id})
        assert api.delete_task(1, cascade=False) is True
        assert len(api.get_tasks()) == 2

    def test_delete_nonexistent(self, api):
        assert api.delete_task(999) is False


class TestJsApiUpdateValidations:
    def test_update_validations_dict(self, api):
        result = api.update_validations({"ステータス": ["未着手", "完了"]})
        assert result["ok"] is True
        assert result["validations"]["ステータス"] == ["未着手", "完了"]

    def test_update_validations_json_string(self, api):
        result = api.update_validations(json.dumps({"ステータス": ["未着手", "完了"]}))
        assert result["ok"] is True
        assert result["validations"]["ステータス"] == ["未着手", "完了"]

    def test_update_validations_empty(self, api):
        result = api.update_validations({})
        assert result["ok"] is True
        assert "ステータス" in result["validations"]
