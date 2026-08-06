"""
会话历史 JSON 存储 —— 线程安全读写 sessions.json
用于站内聊天面板的「历史记录 + 继续对话」：保存用户会话的消息、Dify conversation_id、工作流类型。
按 username 隔离（每个用户只能读写自己的会话）。
"""
from __future__ import annotations

import json
import threading
from datetime import datetime
from typing import Optional
from uuid import uuid4

from config import SESSIONS_JSON_PATH

_lock = threading.Lock()

# 标题截断长度（取首条用户问题）
TITLE_MAX_LEN = 20


def _now() -> str:
    return datetime.now().isoformat()


def _read_all() -> list[dict]:
    if not SESSIONS_JSON_PATH.exists():
        return []
    try:
        with open(SESSIONS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(items: list[dict]) -> None:
    SESSIONS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(SESSIONS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def create_session(username: str, workflow_id: str, workflow_type: str, title: str) -> dict:
    """创建新会话。title 通常为首条用户问题截断。"""
    session = {
        "id": str(uuid4()),
        "username": username,
        "workflow_id": workflow_id,
        "type": workflow_type,          # chatflow | workflow
        "title": (title or "新对话")[:TITLE_MAX_LEN],
        "conversation_id": "",
        "messages": [],                 # [{role, content, ts}]
        "created_at": _now(),
        "updated_at": _now(),
    }
    with _lock:
        items = _read_all()
        items.append(session)
        _write_all(items)
    return session


def _find_item(items: list[dict], session_id: str, username: str) -> Optional[dict]:
    for it in items:
        if it.get("id") == session_id and it.get("username") == username:
            return it
    return None


def append_message(session_id: str, username: str, role: str, content: str,
                   conversation_id: str | None = None) -> bool:
    """向会话追加一条消息。若传入 conversation_id 则一并回写（续聊关键）。"""
    ts = _now()
    with _lock:
        items = _read_all()
        item = _find_item(items, session_id, username)
        if item is None:
            return False
        messages = item.setdefault("messages", [])
        messages.append({"role": role, "content": content, "ts": ts})
        if conversation_id:
            item["conversation_id"] = conversation_id
        # 标题：若为空则以首条用户消息截断
        if not item.get("title") and role == "user":
            item["title"] = (content or "新对话")[:TITLE_MAX_LEN]
        item["updated_at"] = ts
        _write_all(items)
    return True


def list_sessions(username: str, limit: int = 200) -> list[dict]:
    """返回当前用户的会话摘要列表（不含完整 messages），按 updated_at 倒序。"""
    with _lock:
        items = _read_all()
    mine = [it for it in items if it.get("username") == username]
    mine.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    result = []
    for it in mine[:limit]:
        result.append({
            "id": it.get("id"),
            "workflow_id": it.get("workflow_id"),
            "type": it.get("type"),
            "title": it.get("title", "新对话"),
            "conversation_id": it.get("conversation_id", ""),
            "message_count": len(it.get("messages", [])),
            "created_at": it.get("created_at"),
            "updated_at": it.get("updated_at"),
        })
    return result


def get_session(username: str, session_id: str) -> Optional[dict]:
    """返回单条会话（含完整 messages 与 conversation_id）；校验归属。"""
    with _lock:
        items = _read_all()
        item = _find_item(items, session_id, username)
        return dict(item) if item is not None else None


def update_conversation_id(session_id: str, username: str, conversation_id: str) -> bool:
    """更新会话的 Dify conversation_id（续聊钥匙）。"""
    if not conversation_id:
        return False
    with _lock:
        items = _read_all()
        item = _find_item(items, session_id, username)
        if item is None:
            return False
        item["conversation_id"] = conversation_id
        item["updated_at"] = _now()
        _write_all(items)
    return True


def delete_session(username: str, session_id: str) -> bool:
    """删除会话（校验归属）。"""
    with _lock:
        items = _read_all()
        new_list = [it for it in items if not (it.get("id") == session_id and it.get("username") == username)]
        if len(new_list) == len(items):
            return False
        _write_all(new_list)
    return True
