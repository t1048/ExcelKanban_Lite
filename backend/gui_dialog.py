# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import tkinter as tk
from tkinter import filedialog, messagebox, ttk


def load_exec_options(path: Path) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as fp:
            data = json.load(fp)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {}


def save_exec_options(path: Path, options: Dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fp:
            json.dump(options, fp, ensure_ascii=False, indent=2)
    except OSError:
        print(f"[kanban] 設定ファイルを保存できませんでした: {path}")


def open_option_dialog(initial_options: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    root = tk.Tk()
    root.title("Excel Kanban 起動設定")
    root.resizable(False, False)

    result: Dict[str, Any] = {}
    cancelled = {"value": False}

    def on_cancel():
        cancelled["value"] = True
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_cancel)

    main_frame = ttk.Frame(root, padding=10)
    main_frame.grid(row=0, column=0, sticky="nsew")
    main_frame.columnconfigure(1, weight=1)

    string_fields = {
        "excel": tk.StringVar(value=str(initial_options.get("excel", ""))),
        "html": tk.StringVar(value=str(initial_options.get("html", ""))),
        "title": tk.StringVar(value=str(initial_options.get("title", ""))),
        "sheet": tk.StringVar(value=str(initial_options.get("sheet", "") or "")),
        "width": tk.StringVar(value=str(initial_options.get("width", ""))),
        "height": tk.StringVar(value=str(initial_options.get("height", ""))),
        "watch_interval": tk.StringVar(value=str(initial_options.get("watch_interval", ""))),
        "watch_debounce": tk.StringVar(value=str(initial_options.get("watch_debounce", ""))),
    }

    bool_fields = {
        "debug": tk.BooleanVar(value=bool(initial_options.get("debug", False))),
        "no_watch": tk.BooleanVar(value=bool(initial_options.get("no_watch", False))),
        "watch_polling": tk.BooleanVar(value=bool(initial_options.get("watch_polling", False))),
    }

    def build_file_row(row: int, label: str, field_key: str, filetypes: Tuple[Tuple[str, str], ...]):
        ttk.Label(main_frame, text=label).grid(row=row, column=0, sticky="w", pady=2)
        entry = ttk.Entry(main_frame, textvariable=string_fields[field_key], width=50)
        entry.grid(row=row, column=1, sticky="we", pady=2)

        def browse():
            initial = string_fields[field_key].get() or ""
            initial_dir = os.path.dirname(initial) if initial else os.getcwd()
            selected = filedialog.askopenfilename(
                title=f"{label} を選択",
                initialdir=initial_dir,
                filetypes=filetypes,
            )
            if selected:
                string_fields[field_key].set(selected)

        ttk.Button(main_frame, text="参照", command=browse).grid(row=row, column=2, padx=(4, 0))

    build_file_row(0, "Excel ファイル", "excel", (("Excel", "*.xlsx"), ("すべて", "*.*")))
    build_file_row(1, "HTML ファイル", "html", (("HTML", "*.html"), ("すべて", "*.*")))

    ttk.Label(main_frame, text="ウィンドウタイトル").grid(row=2, column=0, sticky="w", pady=2)
    ttk.Entry(main_frame, textvariable=string_fields["title"], width=50).grid(
        row=2, column=1, columnspan=2, sticky="we", pady=2
    )

    ttk.Label(main_frame, text="ウィンドウサイズ (幅 x 高さ)").grid(
        row=3, column=0, sticky="w", pady=2
    )
    size_frame = ttk.Frame(main_frame)
    size_frame.grid(row=3, column=1, columnspan=2, sticky="w", pady=2)
    ttk.Entry(size_frame, textvariable=string_fields["width"], width=10).grid(row=0, column=0)
    ttk.Label(size_frame, text="x").grid(row=0, column=1, padx=4)
    ttk.Entry(size_frame, textvariable=string_fields["height"], width=10).grid(row=0, column=2)

    ttk.Label(main_frame, text="シート名").grid(row=4, column=0, sticky="w", pady=2)
    ttk.Entry(main_frame, textvariable=string_fields["sheet"], width=20).grid(
        row=4, column=1, columnspan=2, sticky="we", pady=2
    )

    ttk.Label(main_frame, text="監視設定").grid(row=5, column=0, sticky="w", pady=(8, 2))
    checks_frame = ttk.Frame(main_frame)
    checks_frame.grid(row=5, column=1, columnspan=2, sticky="w", pady=(8, 2))
    ttk.Checkbutton(
        checks_frame,
        text="デバッグモード",
        variable=bool_fields["debug"],
    ).grid(row=0, column=0, sticky="w")
    ttk.Checkbutton(
        checks_frame,
        text="ファイル監視を無効化",
        variable=bool_fields["no_watch"],
    ).grid(row=0, column=1, sticky="w", padx=(10, 0))
    ttk.Checkbutton(
        checks_frame,
        text="PollingObserver を使用",
        variable=bool_fields["watch_polling"],
    ).grid(row=0, column=2, sticky="w", padx=(10, 0))

    ttk.Label(main_frame, text="監視間隔 (秒)").grid(row=6, column=0, sticky="w", pady=2)
    ttk.Entry(main_frame, textvariable=string_fields["watch_interval"], width=10).grid(
        row=6, column=1, sticky="w", pady=2
    )

    ttk.Label(main_frame, text="監視ディレイ (秒)").grid(row=7, column=0, sticky="w", pady=2)
    ttk.Entry(main_frame, textvariable=string_fields["watch_debounce"], width=10).grid(
        row=7, column=1, sticky="w", pady=2
    )

    button_frame = ttk.Frame(main_frame)
    button_frame.grid(row=8, column=0, columnspan=3, pady=(12, 0))

    def on_submit():
        try:
            width_value = int(string_fields["width"].get())
            height_value = int(string_fields["height"].get())
        except ValueError:
            messagebox.showerror("入力エラー", "幅と高さには整数を入力してください。")
            return

        try:
            watch_interval_value = float(string_fields["watch_interval"].get())
            watch_debounce_value = float(string_fields["watch_debounce"].get())
        except ValueError:
            messagebox.showerror("入力エラー", "監視間隔と監視ディレイには数値を入力してください。")
            return

        result.update(
            {
                "excel": string_fields["excel"].get().strip(),
                "html": string_fields["html"].get().strip(),
                "title": string_fields["title"].get().strip(),
                "width": width_value,
                "height": height_value,
                "sheet": string_fields["sheet"].get().strip(),
                "debug": bool_fields["debug"].get(),
                "no_watch": bool_fields["no_watch"].get(),
                "watch_polling": bool_fields["watch_polling"].get(),
                "watch_interval": watch_interval_value,
                "watch_debounce": watch_debounce_value,
            }
        )
        root.destroy()

    ttk.Button(button_frame, text="キャンセル", command=on_cancel).grid(row=0, column=0, padx=5)
    ttk.Button(button_frame, text="起動", command=on_submit).grid(row=0, column=1, padx=5)

    root.mainloop()

    if cancelled["value"]:
        return None

    result["sheet"] = result.get("sheet") or ""
    return result
