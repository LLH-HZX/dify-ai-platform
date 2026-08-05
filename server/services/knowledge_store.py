"""
RAGFlow 全局配置存储 —— 读写 ragflow_config.json
"""
from __future__ import annotations

import json
import threading
from typing import Optional

from config import RAGFLOW_CONFIG_JSON_PATH

_lock = threading.Lock()

_DEFAULTS = {
    "baseUrl": "",
    "apiKey": "",
    "enabled": False,
}


def _read() -> dict:
    if not RAGFLOW_CONFIG_JSON_PATH.exists():
        return dict(_DEFAULTS)
    try:
        with open(RAGFLOW_CONFIG_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        cfg = dict(_DEFAULTS)
        if isinstance(data, dict):
            cfg.update(data)
        return cfg
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULTS)


def _write(cfg: dict) -> None:
    RAGFLOW_CONFIG_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RAGFLOW_CONFIG_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_config(include_api_key: bool = False) -> dict:
    with _lock:
        cfg = _read()
    result = dict(cfg)
    if not include_api_key:
        result.pop("apiKey", None)
    return result


def get_full_config() -> dict:
    """内部使用：含 apiKey"""
    with _lock:
        return _read()


def save_config(data: dict) -> dict:
    """保存 RAGFlow 全局配置。apiKey 为空时保留旧值（避免误清空）。"""
    with _lock:
        cfg = _read()
        if "baseUrl" in data and data["baseUrl"] is not None:
            cfg["baseUrl"] = str(data["baseUrl"]).strip()
        if "apiKey" in data and data["apiKey"] is not None:
            val = str(data["apiKey"]).strip()
            if val:
                cfg["apiKey"] = val
        if "enabled" in data and data["enabled"] is not None:
            cfg["enabled"] = bool(data["enabled"])
        _write(cfg)
    return dict(cfg)


def get_credentials() -> Optional[dict]:
    """获取可用的 RAGFlow 连接配置；未配置或未启用时返回 None。"""
    cfg = get_full_config()
    if not cfg.get("enabled"):
        return None
    if not cfg.get("baseUrl") or not cfg.get("apiKey"):
        return None
    return {
        "baseUrl": cfg["baseUrl"],
        "apiKey": cfg["apiKey"],
    }
