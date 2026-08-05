"""
知识库实体存储 —— 读写 knowledge_bases.json
每个知识库实体包含：id / name / baseUrl / apiKey / owner(归属人) / created_at
多个 RAGFlow 服务器可并存，互不覆盖。
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
from typing import Optional

from config import KNOWLEDGE_BASES_JSON_PATH

_lock = threading.Lock()


def _read_all() -> list[dict]:
    if not KNOWLEDGE_BASES_JSON_PATH.exists():
        return []
    try:
        with open(KNOWLEDGE_BASES_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(items: list[dict]) -> None:
    KNOWLEDGE_BASES_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(KNOWLEDGE_BASES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def list_bases(include_api_key: bool = False) -> list[dict]:
    """列出全部知识库实体。include_api_key=False 时不返回 apiKey（列表展示用）。"""
    with _lock:
        items = _read_all()
    results = []
    for it in items:
        item = dict(it)
        if not include_api_key:
            item.pop("apiKey", None)
        results.append(item)
    return results


def get_base(base_id: str, include_api_key: bool = False) -> Optional[dict]:
    with _lock:
        items = _read_all()
    for it in items:
        if it.get("id") == base_id:
            item = dict(it)
            if not include_api_key:
                item.pop("apiKey", None)
            return item
    return None


def get_full_base(base_id: str) -> Optional[dict]:
    """内部使用：含 apiKey。"""
    return get_base(base_id, include_api_key=True)


def create_base(data: dict) -> dict:
    new_item = {
        "id": data.get("id") or str(uuid.uuid4()),
        "name": data["name"],
        "baseUrl": (data.get("baseUrl") or "").rstrip("/"),
        "apiKey": data.get("apiKey") or "",
        "owner": data.get("owner") or "",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    with _lock:
        items = _read_all()
        items.append(new_item)
        _write_all(items)
    result = dict(new_item)
    result.pop("apiKey", None)
    return result


def update_base(base_id: str, data: dict) -> Optional[dict]:
    """仅更新提供的字段。apiKey 为空字符串表示不修改（保留旧值）。"""
    with _lock:
        items = _read_all()
        for i, it in enumerate(items):
            if it.get("id") == base_id:
                if "name" in data and data["name"] is not None:
                    it["name"] = data["name"]
                if "baseUrl" in data and data["baseUrl"] is not None:
                    it["baseUrl"] = str(data["baseUrl"]).rstrip("/")
                if "apiKey" in data and data["apiKey"]:
                    it["apiKey"] = data["apiKey"]
                items[i] = it
                _write_all(items)
                result = dict(it)
                result.pop("apiKey", None)
                return result
    return None


def delete_base(base_id: str) -> bool:
    with _lock:
        items = _read_all()
        new_list = [it for it in items if it.get("id") != base_id]
        if len(new_list) == len(items):
            return False
        _write_all(new_list)
    return True
