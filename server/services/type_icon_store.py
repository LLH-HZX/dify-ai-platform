"""
类型图标 JSON 存储 —— 线程安全读写 type_icons.json

记录三种应用类型（chatflow / workflow / agent）各自的全局图标 URL。
结构：{"chatflow": "/uploads/xxx.png", "workflow": "", "agent": ""}
"""
from __future__ import annotations

import json
import threading

from config import TYPE_ICONS_JSON_PATH

# 支持的三种类型
TYPE_KEYS = ("chatflow", "workflow", "agent")

_lock = threading.Lock()


def _read_all() -> dict:
    if not TYPE_ICONS_JSON_PATH.exists():
        return {}
    try:
        with open(TYPE_ICONS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _write_all(data: dict) -> None:
    TYPE_ICONS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(TYPE_ICONS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_type_icons() -> dict:
    """返回全部类型图标 URL 字典，缺失的键补空串。"""
    with _lock:
        data = _read_all()
    return {key: data.get(key, "") for key in TYPE_KEYS}


def get_type_icon(type_name: str) -> str:
    """返回单个类型图标 URL（未知类型返回空串）。"""
    if type_name not in TYPE_KEYS:
        return ""
    with _lock:
        data = _read_all()
    return data.get(type_name, "")


def set_type_icon(type_name: str, url: str) -> dict:
    """保存单个类型图标，返回保存后的全部类型图标。type_name 需在 TYPE_KEYS 内。"""
    if type_name not in TYPE_KEYS:
        raise ValueError(f"未知类型: {type_name}")
    with _lock:
        data = _read_all()
        data[type_name] = url
        _write_all(data)
        return {key: data.get(key, "") for key in TYPE_KEYS}
