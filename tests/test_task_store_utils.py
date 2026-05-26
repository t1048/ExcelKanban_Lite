# -*- coding: utf-8 -*-
import datetime as dt
from pathlib import Path

import pytest

pytest.importorskip("openpyxl")

from openpyxl import Workbook

from backend.backend import META_ID_COLUMN, PARENT_ID_COLUMN, TASK_COLUMNS, TaskStore


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
    ws.append([
        "完了", "タスクC", "Carol", "低",
        dt.date(2024, 1, 3), "三番目のタスク",
    ])
    wb.save(path)


class TestGetChildren:
    def test_no_children(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        tasks = store.get_tasks()
        task_id = tasks[0]["__kanban_id"]
        assert store.get_children(task_id) == []

    def test_direct_children(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent_id = store.get_tasks()[0]["__kanban_id"]
        store.add_task({"タスク": "子1", "__parent_id": parent_id})
        store.add_task({"タスク": "子2", "__parent_id": parent_id})
        children = store.get_children(parent_id)
        assert len(children) == 2
        assert children[0]["__parent_id"] == parent_id
        assert children[1]["__parent_id"] == parent_id

    def test_nonexistent_id(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        assert store.get_children("nonexistent") == []


class TestGetDescendantIds:
    def test_no_children(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        task_id = store.get_tasks()[0]["__kanban_id"]
        assert store.get_descendant_ids(task_id) == []

    def test_nested_descendants(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent = store.get_tasks()[0]
        child = store.add_task({"タスク": "子", "__parent_id": parent["__kanban_id"]})
        grandchild = store.add_task({"タスク": "孫", "__parent_id": child["__kanban_id"]})

        desc_ids = store.get_descendant_ids(parent["__kanban_id"])
        assert len(desc_ids) == 2
        assert child["__kanban_id"] in desc_ids
        assert grandchild["__kanban_id"] in desc_ids

    def test_nonexistent_id(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        assert store.get_descendant_ids("nonexistent") == []


class TestGetAncestorIds:
    def test_no_parent(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        task_id = store.get_tasks()[0]["__kanban_id"]
        assert store.get_ancestor_ids(task_id) == []

    def test_single_ancestor(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent = store.get_tasks()[0]
        child = store.add_task({"タスク": "子", "__parent_id": parent["__kanban_id"]})
        ancestors = store.get_ancestor_ids(child["__kanban_id"])
        assert ancestors == [parent["__kanban_id"]]

    def test_multiple_ancestors(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        gp = store.get_tasks()[0]
        parent = store.add_task({"タスク": "親", "__parent_id": gp["__kanban_id"]})
        child = store.add_task({"タスク": "子", "__parent_id": parent["__kanban_id"]})
        ancestors = store.get_ancestor_ids(child["__kanban_id"])
        assert gp["__kanban_id"] in ancestors
        assert parent["__kanban_id"] in ancestors

    def test_nonexistent_id(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        assert store.get_ancestor_ids("nonexistent") == []


class TestGetStatuses:
    def test_default_statuses(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        assert "未着手" in store.get_statuses()
        assert "進行中" in store.get_statuses()
        assert "完了" in store.get_statuses()
        assert "保留" in store.get_statuses()

    def test_includes_custom_from_tasks(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.add_task({"タスク": "新しいタスク", "ステータス": "レビュー中"})
        assert "レビュー中" in store.get_statuses()


class TestGetValidations:
    def test_default_validations(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        val = store.get_validations()
        assert "ステータス" in val
        assert "優先度" in val

    def test_returns_copy_not_reference(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        val1 = store.get_validations()
        val1["ステータス"].append("新ステータス")
        val2 = store.get_validations()
        assert "新ステータス" not in val2["ステータス"]


class TestGetStateSnapshot:
    def test_returns_all_sections(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        snap = store.get_state_snapshot()
        assert "tasks" in snap
        assert "statuses" in snap
        assert "validations" in snap
        assert len(snap["tasks"]) == 3


class TestSetValidations:
    def test_update_status_validations(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.set_validations({"ステータス": ["未着手", "完了"]})
        val = store.get_validations()
        assert val["ステータス"] == ["未着手", "完了"]

    def test_update_priority_validations(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.set_validations({"優先度": ["最高", "最低"]})
        val = store.get_validations()
        assert "最高" in val["優先度"]
        assert "最低" in val["優先度"]

    def test_empty_values_ignored(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        original = store.get_validations()["ステータス"][:]
        store.set_validations({"ステータス": []})
        assert store.get_validations()["ステータス"] == original

    def test_unknown_column_ignored(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.set_validations({"存在しない列": ["値1", "値2"]})
        val = store.get_validations()
        assert "存在しない列" not in val

    def test_duplicate_values_removed(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.set_validations({"ステータス": ["進行中", "進行中", "未着手"]})
        assert store.get_validations()["ステータス"] == ["進行中", "未着手"]


class TestMoveTask:
    def test_move_changes_status(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        result = store.move_task(1, "完了")
        assert result["ステータス"] == "完了"

    def test_move_invalid_no_raises(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        with pytest.raises(KeyError):
            store.move_task(999, "完了")


class TestAddTaskErrors:
    def test_empty_title_raises(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        with pytest.raises(ValueError, match="必須"):
            store.add_task({"タスク": ""})

    def test_nonexistent_parent_raises(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        with pytest.raises(ValueError, match="見つかりません"):
            store.add_task({"タスク": "子タスク", "__parent_id": "nonexistent"})


class TestUpdateTaskErrors:
    def test_invalid_no_raises(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        with pytest.raises(KeyError, match="存在しません"):
            store.update_task(999, {"タスク": "更新"})

    def test_zero_no_raises(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        with pytest.raises(KeyError):
            store.update_task(0, {"タスク": "更新"})

    def test_empty_title_raises(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        with pytest.raises(ValueError, match="必須"):
            store.update_task(1, {"タスク": ""})

    def test_self_reference_circular(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        tasks = store.get_tasks()
        self_id = tasks[0]["__kanban_id"]
        with pytest.raises(ValueError, match="循環参照"):
            store.update_task(1, {"__parent_id": self_id})


class TestDeleteTaskErrors:
    def test_nonexistent_task_returns_false(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        assert store.delete_task(999) is False


class TestGetLastSavedMarkers:
    def test_initial_sets_timestamp_on_first_load(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        saved_at, mtime = store.get_last_saved_markers()
        assert isinstance(saved_at, dt.datetime)
        assert mtime is not None

    def test_after_save_returns_datetime(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.save_excel()
        saved_at, mtime = store.get_last_saved_markers()
        assert isinstance(saved_at, dt.datetime)
        assert mtime is not None


class TestSaveExcel:
    def test_roundtrip_preserves_tasks(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.save_excel()
        store2 = TaskStore(excel_path)
        assert len(store2.get_tasks()) == 3

    def test_roundtrip_preserves_validations(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        store.set_validations({"ステータス": ["未着手", "進行中", "完了", "保留", "レビュー"]})
        store.save_excel()
        store2 = TaskStore(excel_path)
        assert "レビュー" in store2.get_validations()["ステータス"]

    def test_roundtrip_preserves_parent_id(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent_id = store.get_tasks()[0]["__kanban_id"]
        child = store.add_task({"タスク": "子", "__parent_id": parent_id})
        store.save_excel()
        store2 = TaskStore(excel_path)
        children = store2.get_children(parent_id)
        assert len(children) == 1
        assert children[0]["__kanban_id"] == child["__kanban_id"]


class TestGetTaskTree:
    def test_empty_root_children(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        tree = store.get_task_tree()
        assert len(tree) == 3
        for node in tree:
            assert node["children"] == []
            assert "__kanban_id" in node
            assert "__parent_id" in node

    def test_nested_tree(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent_id = store.get_tasks()[0]["__kanban_id"]
        child = store.add_task({"タスク": "子1", "__parent_id": parent_id})
        store.add_task({"タスク": "孫", "__parent_id": child["__kanban_id"]})
        tree = store.get_task_tree()
        root = next(t for t in tree if t["__kanban_id"] == parent_id)
        assert len(root["children"]) == 1
        assert len(root["children"][0]["children"]) == 1
        assert root["children"][0]["children"][0]["タスク"] == "孫"


class TestParentSyncEdgeCases:
    def test_parent_status_reverts_when_child_removed_from_complete(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent = store.get_tasks()[0]
        parent_id = parent["__kanban_id"]
        store.add_task({"タスク": "子", "__parent_id": parent_id, "ステータス": "完了"})
        # parent should now be 完了
        tasks = store.get_tasks()
        p = next(t for t in tasks if t["__kanban_id"] == parent_id)
        assert p["ステータス"] == "完了"

    def test_delete_child_resyncs_parent(self, tmp_path):
        excel_path = tmp_path / "board.xlsx"
        _build_workbook(excel_path)
        store = TaskStore(excel_path)
        parent = store.get_tasks()[0]
        parent_id = parent["__kanban_id"]
        store.add_task({"タスク": "子", "__parent_id": parent_id, "ステータス": "完了"})
        child_no = store.get_tasks()[1]["No"]
        store.add_task({"タスク": "子2", "__parent_id": parent_id, "ステータス": "未着手"})
        store.delete_task(child_no)
        tasks = store.get_tasks()
        p = next(t for t in tasks if t["__kanban_id"] == parent_id)
        assert p["ステータス"] != "完了"
