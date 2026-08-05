"""
用户账号 JSON 存储 —— 线程安全读写 users.json
"""
from __future__ import annotations

import json
import threading
from typing import Optional

from config import USERS_JSON_PATH

_lock = threading.Lock()


def _read_all() -> list[dict]:
    if not USERS_JSON_PATH.exists():
        return []
    try:
        with open(USERS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_all(users: list[dict]) -> None:
    USERS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(USERS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def list_users(include_password: bool = False) -> list[dict]:
    """获取全部账号。默认不含密码哈希。"""
    with _lock:
        users = _read_all()
    results = []
    for u in users:
        item = {
            "username": u.get("username", ""),
            "role": u.get("role", "user"),
            "allowed_workflow_ids": list(u.get("allowed_workflow_ids") or []),
        }
        if include_password:
            item["password"] = u.get("password", "")
        results.append(item)
    return results


def get_user(username: str) -> Optional[dict]:
    """按用户名查找（含密码哈希，内部校验用）。"""
    with _lock:
        users = _read_all()
    for u in users:
        if u.get("username") == username:
            return dict(u)
    return None


def create_user(username: str, password_hash: str, role: str,
                allowed_workflow_ids: Optional[list] = None) -> dict:
    with _lock:
        users = _read_all()
        for u in users:
            if u["username"] == username:
                raise ValueError(f"用户名 '{username}' 已存在")
        new_user = {
            "username": username,
            "password": password_hash,
            "role": role,
            "allowed_workflow_ids": list(allowed_workflow_ids or []),
        }
        users.append(new_user)
        _write_all(users)
    return {
        "username": username,
        "role": role,
        "allowed_workflow_ids": list(allowed_workflow_ids or []),
    }


def update_user(username: str, data: dict) -> Optional[dict]:
    """更新账号（password_hash / role / allowed_workflow_ids）。"""
    with _lock:
        users = _read_all()
        for i, u in enumerate(users):
            if u["username"] == username:
                if "password" in data and data["password"]:
                    u["password"] = data["password"]
                if "role" in data and data["role"]:
                    u["role"] = data["role"]
                if "allowed_workflow_ids" in data and data["allowed_workflow_ids"] is not None:
                    u["allowed_workflow_ids"] = list(data["allowed_workflow_ids"])
                users[i] = u
                _write_all(users)
                return {
                    "username": u["username"],
                    "role": u["role"],
                    "allowed_workflow_ids": list(u.get("allowed_workflow_ids") or []),
                }
    return None


def delete_user(username: str) -> bool:
    with _lock:
        users = _read_all()
        new_list = [u for u in users if u["username"] != username]
        if len(new_list) == len(users):
            return False
        _write_all(new_list)
    return True


def count_by_role(role: str) -> int:
    with _lock:
        users = _read_all()
    return sum(1 for u in users if u.get("role") == role)


def get_allowed_workflow_ids(username: str) -> set:
    """获取某用户被授权的工作流 id 集合（admin 角色忽略，返回空集表示不受限）。"""
    user = get_user(username)
    if user is None:
        return set()
    return set(user.get("allowed_workflow_ids") or [])


def user_has_workflow(username: str, role: str, workflow_id: str) -> bool:
    """判断用户是否有权使用某工作流。admin 始终有权。"""
    if role == "admin":
        return True
    return workflow_id in get_allowed_workflow_ids(username)
