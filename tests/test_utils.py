# -*- coding: utf-8 -*-
import datetime as dt
import re

import pandas as pd
import pytest

from backend.utils import (
    format_priority,
    from_iso_date_str,
    normalize_priority,
    sanitize_text_for_excel,
    to_iso_date_str,
)


class TestToIsoDateStr:
    def test_na_returns_empty(self):
        assert to_iso_date_str(None) == ""
        assert to_iso_date_str(pd.NA) == ""
        assert to_iso_date_str(float("nan")) == ""

    def test_datetime_objects(self):
        assert to_iso_date_str(dt.date(2024, 1, 1)) == "2024-01-01"
        assert to_iso_date_str(dt.datetime(2024, 1, 1, 12, 30)) == "2024-01-01"
        assert to_iso_date_str(pd.Timestamp("2024-12-31")) == "2024-12-31"

    def test_string_date(self):
        assert to_iso_date_str("2024-01-01") == "2024-01-01"
        assert to_iso_date_str("2024/01/01") == "2024-01-01"

    def test_invalid_string_returns_original(self):
        assert to_iso_date_str("not a date") == "not a date"

    def test_mixed_type_string(self):
        assert to_iso_date_str("") == ""


class TestFromIsoDateStr:
    def test_empty_returns_nat(self):
        assert from_iso_date_str("") is pd.NaT
        assert from_iso_date_str("   ") is pd.NaT
        assert from_iso_date_str(None) is pd.NaT

    def test_valid_date(self):
        result = from_iso_date_str("2024-01-01")
        assert result == dt.date(2024, 1, 1)

    def test_invalid_string_returns_nat(self):
        assert from_iso_date_str("not a date") is pd.NaT


class TestNormalizePriority:
    def test_none_and_na(self):
        assert normalize_priority(None) is pd.NA
        assert normalize_priority(pd.NA) is pd.NA

    def test_empty_string(self):
        assert normalize_priority("") is pd.NA
        assert normalize_priority("   ") is pd.NA

    def test_integer(self):
        assert normalize_priority(1) == 1
        assert normalize_priority(0) == 0

    def test_float_integer(self):
        assert normalize_priority(3.0) == 3

    def test_float_non_integer(self):
        assert normalize_priority(3.5) == 3.5

    def test_numeric_string(self):
        assert normalize_priority("1") == 1
        assert normalize_priority("3.5") == 3.5

    def test_non_numeric_string(self):
        assert normalize_priority("高") == "高"

    def test_pandas_na_variants(self):
        assert normalize_priority(float("nan")) is pd.NA


class TestFormatPriority:
    def test_na_returns_empty(self):
        assert format_priority(None) == ""
        assert format_priority(pd.NA) == ""
        assert format_priority(float("nan")) == ""

    def test_integer(self):
        assert format_priority(1) == 1
        assert format_priority(0) == 0

    def test_float_integer(self):
        assert format_priority(3.0) == 3

    def test_float_non_integer(self):
        assert format_priority(3.5) == 3.5

    def test_string(self):
        assert format_priority("高") == "高"


class TestSanitizeTextForExcel:
    def test_crlf_to_lf(self):
        assert sanitize_text_for_excel("a\r\nb") == "a\nb"

    def test_cr_to_lf(self):
        assert sanitize_text_for_excel("a\rb") == "a\nb"

    def test_formula_prefix_escaped(self):
        assert sanitize_text_for_excel("=SUM(A1)") == "\u200B=SUM(A1)"
        assert sanitize_text_for_excel("+A1") == "\u200B+A1"
        assert sanitize_text_for_excel("-A1") == "\u200B-A1"
        assert sanitize_text_for_excel("@A1") == "\u200B@A1"

    def test_normal_text_unchanged(self):
        assert sanitize_text_for_excel("hello") == "hello"
        assert sanitize_text_for_excel("123") == "123"

    def test_empty_string_returns_none(self):
        assert sanitize_text_for_excel("") is None

    def test_only_whitespace_returns_whitespace(self):
        assert sanitize_text_for_excel(" ") == " "

    def test_mixed_crlf(self):
        assert sanitize_text_for_excel("line1\r\nline2\rline3\nline4") == "line1\nline2\nline3\nline4"
