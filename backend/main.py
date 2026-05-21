# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import webview

from .gui_dialog import load_exec_options, open_option_dialog, save_exec_options
from .js_api import JsApi
from .task_store import TaskStore
from .excel_watcher import start_excel_watcher


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Excel Kanban backend")
    parser.add_argument("--excel", default="./data/task.xlsx")
    parser.add_argument("--html", default="./frontend/pages/index.html")
    parser.add_argument("--title", default="タスク・ボード")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=800)
    parser.add_argument("--debug", action="store_true")
    parser.add_argument(
        "--sheet",
        default=None,
        help="Excel ファイルから読み込むシート名 (未指定時は先頭のシート)",
    )
    parser.add_argument(
        "--no-watch",
        action="store_true",
        help="Excel ファイルの変更監視を無効化します",
    )
    parser.add_argument(
        "--watch-polling",
        action="store_true",
        help="watchdog の PollingObserver を使用します (ネットワークドライブ等向け)",
    )
    parser.add_argument(
        "--watch-interval",
        type=float,
        default=1.0,
        help="PollingObserver 利用時の監視間隔（秒）",
    )
    parser.add_argument(
        "--watch-debounce",
        type=float,
        default=2.0,
        help="アプリ自身の保存直後に発生したイベントを無視する猶予時間（秒）",
    )
    parser.add_argument(
        "--config",
        default=None,
        help="起動オプションを保存する設定ファイルのパス (未指定時は ExecOption.json)",
    )
    parser.add_argument(
        "--no-gui",
        action="store_true",
        help="Tkinter による起動画面を表示せず、コマンドライン引数の値を使用します",
    )
    return parser, parser.parse_args(argv)


def main(argv=None):
    parser, args = parse_args(argv)

    gui_fields = [
        "excel",
        "html",
        "title",
        "width",
        "height",
        "debug",
        "sheet",
        "no_watch",
        "watch_polling",
        "watch_interval",
        "watch_debounce",
    ]

    config_path = (
        Path(args.config).expanduser().resolve()
        if args.config
        else Path(__file__).with_name("ExecOption.json")
    )

    defaults = parser.parse_args([])
    current_options = {field: getattr(args, field) for field in gui_fields}
    stored_options = load_exec_options(config_path)

    for field in gui_fields:
        if field in stored_options:
            default_value = getattr(defaults, field)
            current_value = getattr(args, field)
            if current_value == default_value:
                current_options[field] = stored_options[field]

    if not args.no_gui:
        selected_options = open_option_dialog(current_options)
        if selected_options is None:
            print("[kanban] 起動がキャンセルされました。")
            return
        save_exec_options(config_path, selected_options)
        for field in gui_fields:
            setattr(args, field, selected_options[field])
    else:
        for field in gui_fields:
            setattr(args, field, current_options[field])

    args.sheet = (args.sheet or "").strip() or None

    excel_path = Path(args.excel).expanduser().resolve()
    html_path = Path(args.html).expanduser().resolve()
    if not html_path.exists():
        raise FileNotFoundError(f"HTML が見つかりません: {html_path}")

    store = TaskStore(excel_path, sheet_name=args.sheet)
    api = JsApi(store)

    window = webview.create_window(
        title=args.title,
        url=html_path.as_uri(),
        width=args.width,
        height=args.height,
        js_api=api,
    )

    def bootstrap_file_watcher():  # pragma: no cover - runtime behaviour
        if args.no_watch:
            print("[kanban] File watcher disabled via --no-watch option.")
            return

        observer = start_excel_watcher(
            window,
            store,
            debounce_seconds=max(0.0, float(args.watch_debounce)),
            use_polling=args.watch_polling,
            poll_interval=float(args.watch_interval),
        )
        if observer is None:
            return

        def _stop_observer():
            try:
                observer.stop()
                observer.join(timeout=5)
                print("[kanban] Excel watcher stopped.")
            except Exception:
                pass

        events = getattr(window, "events", None)
        if events is not None and hasattr(events, "closed"):
            events.closed += _stop_observer

    webview.start(
        func=bootstrap_file_watcher,
        debug=args.debug,
        http_server=False,
        gui="edgechromium",
        private_mode=False,
    )


if __name__ == "__main__":
    main()
