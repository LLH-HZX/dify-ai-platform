"""
操作日志审计 —— 记录管理员在后台的关键配置操作
写 audit_log.json（追加，保留最近 MAX 条）
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime

from config import AUDIT_LOG_JSON_PATH

_lock = threading.Lock()

# 最多保留的日志条数，超出丢弃最旧的
MAX_LOGS = 500


def _read() -> list[dict]:
    if not AUDIT_LOG_JSON_PATH.exists():
        return []
    try:
        with open(AUDIT_LOG_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write(logs: list[dict]) -> None:
    AUDIT_LOG_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(AUDIT_LOG_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)


def add_log(username: str, action: str, detail: str = "") -> None:
    """记录一条操作日志。username 为操作者，action 为动作描述，detail 为补充信息。"""
    entry = {
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "username": username,
        "action": action,
        "detail": detail,
    }
    with _lock:
        logs = _read()
        logs.append(entry)
        # 只保留最近 MAX_LOGS 条
        if len(logs) > MAX_LOGS:
            logs = logs[-MAX_LOGS:]
        _write(logs)


def list_logs(limit: int = 100) -> list[dict]:
    """返回最近的操作日志（新的在前）。"""
    with _lock:
        logs = _read()
    logs = logs[-limit:][::-1]
    return logs
