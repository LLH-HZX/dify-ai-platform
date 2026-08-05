"""
工作流 JSON 存储 —— 线程安全读写 workflows.json
"""
from __future__ import annotations

import json
import threading
import uuid
from typing import Optional

from config import WORKFLOWS_JSON_PATH

_lock = threading.Lock()


def _read_all() -> list[dict]:
    if not WORKFLOWS_JSON_PATH.exists():
        return []
    try:
        with open(WORKFLOWS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(workflows: list[dict]) -> None:
    WORKFLOWS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(WORKFLOWS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(workflows, f, ensure_ascii=False, indent=2)


def list_workflows(include_api_key: bool = False) -> list[dict]:
    """获取全部工作流。前端调用时 include_api_key=False（不暴露 apiKey）。"""
    with _lock:
        workflows = _read_all()
    results = []
    for w in workflows:
        item = dict(w)
        if not include_api_key:
            item.pop("apiKey", None)
        results.append(item)
    return results


def get_workflow(workflow_id: str) -> Optional[dict]:
    """按 id 查找单个工作流（含 apiKey，内部使用）。"""
    with _lock:
        workflows = _read_all()
    for w in workflows:
        if w.get("id") == workflow_id:
            return dict(w)
    return None


def create_workflow(data: dict) -> dict:
    new_wf = {
        "id": data.get("id") or str(uuid.uuid4()),
        "name": data["name"],
        "icon": data.get("icon", "🤖"),
        "description": data.get("description", ""),
        "type": data.get("type", "chatflow"),
        "category": data.get("category", "默认"),
        "apiKey": data.get("apiKey", ""),
        "baseUrl": data.get("baseUrl", ""),
        "iframeUrl": data.get("iframeUrl", ""),
        "enabled": data.get("enabled", True),
        "ragEnabled": data.get("ragEnabled", False),
        "ragDatasetIds": data.get("ragDatasetIds") or [],
        "ragBindings": data.get("ragBindings") or [],
        "ragTopK": data.get("ragTopK", 3),
        "ragContextVar": data.get("ragContextVar", "context"),
    }
    with _lock:
        workflows = _read_all()
        for w in workflows:
            if w["id"] == new_wf["id"]:
                raise ValueError(f"工作流 id '{new_wf['id']}' 已存在")
        workflows.append(new_wf)
        _write_all(workflows)

    result = dict(new_wf)
    result.pop("apiKey", None)
    return result


def update_workflow(workflow_id: str, data: dict) -> Optional[dict]:
    allowed_keys = (
        "name", "icon", "description", "type", "category",
        "apiKey", "baseUrl", "iframeUrl", "enabled",
        "ragEnabled", "ragDatasetIds", "ragBindings", "ragTopK", "ragContextVar",
    )
    # 空字符串视为"不修改"的字段：前端编辑时若不重新填写，则不覆盖原有密钥
    empty_means_keep = ("apiKey",)
    with _lock:
        workflows = _read_all()
        for i, w in enumerate(workflows):
            if w["id"] == workflow_id:
                for key in allowed_keys:
                    if key in data and data[key] is not None:
                        if key in empty_means_keep and str(data[key]) == "":
                            # 空字符串表示保留原有值，不覆盖
                            continue
                        w[key] = data[key]
                workflows[i] = w
                _write_all(workflows)

                result = dict(w)
                result.pop("apiKey", None)
                return result
    return None


def delete_workflow(workflow_id: str) -> bool:
    with _lock:
        workflows = _read_all()
        new_list = [w for w in workflows if w["id"] != workflow_id]
        if len(new_list) == len(workflows):
            return False
        _write_all(new_list)
    return True


def get_api_key(workflow_id: str) -> Optional[str]:
    """内部使用：获取某个工作流的 API Key"""
    wf = get_workflow(workflow_id)
    if wf is None:
        return None
    return wf.get("apiKey") or None
