"""
对话历史 JSON 存储 —— 线程安全读写 conversations.json
（主要用于后台统计对话次数；也可用于简单的历史记录）
"""
from __future__ import annotations

import json
import threading
from datetime import datetime
from uuid import uuid4

from config import CONVERSATIONS_JSON_PATH

_lock = threading.Lock()


def _read_all() -> list[dict]:
    if not CONVERSATIONS_JSON_PATH.exists():
        return []
    try:
        with open(CONVERSATIONS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(items: list[dict]) -> None:
    CONVERSATIONS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONVERSATIONS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def add_conversation(username: str, workflow_id: str, query: str) -> dict:
    """记录一次对话。返回新记录。"""
    record = {
        "id": str(uuid4()),
        "username": username,
        "workflow_id": workflow_id,
        "query": query,
        "created_at": datetime.now().isoformat(),
    }
    with _lock:
        items = _read_all()
        items.append(record)
        # 简单控制文件大小：最多保留 10000 条
        if len(items) > 10000:
            items = items[-10000:]
        _write_all(items)
    return record


def count_all() -> int:
    with _lock:
        return len(_read_all())


def count_by_workflow() -> dict:
    with _lock:
        items = _read_all()
    result = {}
    for it in items:
        wf = it.get("workflow_id", "")
        result[wf] = result.get(wf, 0) + 1
    return result


def list_recent(limit: int = 50) -> list[dict]:
    with _lock:
        items = _read_all()
    return items[-limit:]
