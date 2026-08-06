"""
会话历史路由（按用户隔离）
  GET /api/sessions         → 当前用户会话摘要列表
  GET /api/sessions/{id}    → 单条会话完整消息 + conversation_id
  DELETE /api/sessions/{id} → 删除会话
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from auth.security import get_current_user
from services import session_store

router = APIRouter(prefix="/api/sessions", tags=["Sessions"])


@router.get("")
def list_sessions(_: dict = Depends(get_current_user), limit: int = 200):
    """返回当前用户的会话摘要列表，按 updated_at 倒序。"""
    username = _["username"]
    return {"sessions": session_store.list_sessions(username, limit=limit)}


@router.get("/{session_id}")
def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """返回单条会话完整消息与 conversation_id（校验归属）。"""
    session = session_store.get_session(current_user["username"], session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {
        "id": session.get("id"),
        "workflow_id": session.get("workflow_id"),
        "type": session.get("type"),
        "title": session.get("title", "新对话"),
        "conversation_id": session.get("conversation_id", ""),
        "messages": session.get("messages", []),
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
    }


@router.delete("/{session_id}")
def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """删除会话（校验归属）。"""
    ok = session_store.delete_session(current_user["username"], session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"ok": True}
