# -*- coding: utf-8 -*-
from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Optional

try:
    from watchdog.events import FileSystemEventHandler
except ImportError:
    FileSystemEventHandler = object  # type: ignore

from .task_store import TaskStore
from .js_api import push_excel_update


class ExcelFileWatcher(FileSystemEventHandler):
    def __init__(
        self,
        store: TaskStore,
        window,
        debounce_seconds: float = 2.0,
    ):
        super().__init__()
        self.store = store
        self.window = window
        self.debounce_seconds = max(0.0, float(debounce_seconds))
        try:
            self._target_path = store.excel_path.resolve()
        except Exception:
            self._target_path = store.excel_path
        self._last_notified_mtime: Optional[float] = None

    def on_modified(self, event):  # pragma: no cover - relies on filesystem events
        self._handle_event(event, [getattr(event, "src_path", None)])

    def on_created(self, event):  # pragma: no cover - relies on filesystem events
        self._handle_event(event, [getattr(event, "src_path", None)])

    def on_moved(self, event):  # pragma: no cover - relies on filesystem events
        paths = [getattr(event, "src_path", None), getattr(event, "dest_path", None)]
        self._handle_event(event, paths)

    def _handle_event(self, event, paths):
        if getattr(event, "is_directory", False):
            return
        for path_str in paths:
            if not path_str:
                continue
            if self._is_target(path_str):
                self._process_change()
                break

    def _is_target(self, path_str: str) -> bool:
        try:
            candidate = Path(path_str).resolve()
        except Exception:
            candidate = Path(path_str)
        try:
            return candidate == self._target_path or candidate.samefile(self._target_path)
        except Exception:
            return candidate == self._target_path

    def _process_change(self):
        now = dt.datetime.now()
        try:
            mtime = self.store.excel_path.stat().st_mtime
        except FileNotFoundError:
            return

        last_saved_at, last_saved_mtime = self.store.get_last_saved_markers()
        if (
            last_saved_at
            and last_saved_mtime is not None
            and abs(mtime - last_saved_mtime) < 0.5
            and (now - last_saved_at).total_seconds() < self.debounce_seconds
        ):
            return

        if self._last_notified_mtime is not None and abs(mtime - self._last_notified_mtime) < 0.5:
            return

        try:
            self.store.load_excel()
            push_excel_update(self.window, self.store)
            self._last_notified_mtime = mtime
            timestamp = now.strftime("%H:%M:%S")
            print(f"[kanban] Excel change detected ({timestamp}), board updated.")
        except Exception as exc:
            print(f"[kanban] Failed to handle Excel change: {exc}")


def start_excel_watcher(
    window,
    store: TaskStore,
    *,
    debounce_seconds: float = 2.0,
    use_polling: bool = False,
    poll_interval: float = 1.0,
):
    try:
        from watchdog.observers import Observer
        from watchdog.observers.polling import PollingObserver
    except ImportError:
        print("[kanban] watchdog is not installed; file watching is disabled.")
        return None

    observer_cls = Observer
    if use_polling:
        observer_cls = PollingObserver

    try:
        if observer_cls is PollingObserver:
            observer = observer_cls(timeout=max(0.1, float(poll_interval)))
        else:
            observer = observer_cls()
    except TypeError:
        observer = observer_cls()

    handler = ExcelFileWatcher(store, window, debounce_seconds=debounce_seconds)
    watch_path = str(store.excel_path.parent)
    observer.schedule(handler, watch_path, recursive=False)
    observer.daemon = True
    observer.start()
    mode = "PollingObserver" if observer_cls is PollingObserver else "Observer"
    print(f"[kanban] Started Excel watcher using {mode} on {watch_path}.")
    return observer
