# -*- coding: utf-8 -*-
from __future__ import annotations

import datetime as dt
from typing import Any

import pandas as pd


def to_iso_date_str(value) -> str:
    if pd.isna(value):
        return ""
    if isinstance(value, (dt.date, dt.datetime, pd.Timestamp)):
        return pd.to_datetime(value).strftime("%Y-%m-%d")
    try:
        return pd.to_datetime(str(value)).strftime("%Y-%m-%d")
    except Exception:
        return str(value)


def from_iso_date_str(value: str):
    value = (value or "").strip()
    if not value:
        return pd.NaT
    try:
        return pd.to_datetime(value).date()
    except Exception:
        return pd.NaT


def normalize_priority(value: Any):
    if value is None or value is pd.NA:
        return pd.NA

    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return pd.NA
        value = trimmed

    if pd.isna(value):
        return pd.NA

    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)

    if pd.isna(num):
        return pd.NA

    if float(num).is_integer():
        return int(num)
    return float(num)


def format_priority(value: Any):
    if pd.isna(value):
        return ""
    if isinstance(value, (int, float)) and not pd.isna(value):
        if isinstance(value, float) and float(value).is_integer():
            return int(value)
        return value
    return str(value)


def sanitize_text_for_excel(text: str) -> str | None:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    first = text[0:1] if text else ""
    if first in ("=", "+", "-", "@"):
        text = "\u200B" + text
    return text if text else None
