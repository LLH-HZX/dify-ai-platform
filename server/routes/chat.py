"""
对话路由
  POST /api/chat → 转发到 Dify（blocking / streaming）
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth.security import get_current_user
from models.schemas import ChatRequest, ChatResponse
from services import conversation_store, session_store
from services.dify_service import call_dify_blocking, call_dify_streaming, DifyAPIError
from services.workflow_store import get_workflow

router = APIRouter(prefix="/api", tags=["Chat"])

logger = logging.getLogger("uvicorn.error")


def _resolve_session(body: ChatRequest, username: str) -> dict:
    """根据请求确定会话：带 session_id 且归属当前用户则沿用，否则新建会话。返回会话记录。"""
    wf = get_workflow(body.workflow_id)
    wf_type = (wf or {}).get("type", "chatflow")
    if body.session_id:
        session = session_store.get_session(username, body.session_id)
        if session is not None:
            return session
    return session_store.create_session(username, body.workflow_id, wf_type, body.query)


@router.post("/chat")
async def send_message(body: ChatRequest, current_user: dict = Depends(get_current_user)):
    files_dicts = [f.model_dump() for f in (body.files or [])]
    username = current_user["username"]

    # 权限校验：普通用户必须被授权使用该工作流
    if current_user["role"] != "admin":
        allowed = set(current_user.get("allowed_workflow_ids") or [])
        if body.workflow_id not in allowed:
            raise HTTPException(
                status_code=403,
                detail="您没有使用该工作流的权限",
            )

    # 记录对话（用于后台统计）
    try:
        conversation_store.add_conversation(username, body.workflow_id, body.query)
    except Exception:
        # 统计失败不影响主流程
        pass

    # 解析/创建会话
    session = _resolve_session(body, username)
    session_id = session["id"]
    # 续聊钥匙：优先用前端传的 conversation_id，否则沿用会话已保存的
    conversation_id = body.conversation_id or session.get("conversation_id", "") or ""

    inputs = dict(body.inputs or {})

    if body.response_mode == "streaming":
        return StreamingResponse(
            _stream_wrapper(body, session_id, username, conversation_id, files_dicts, inputs),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        result = await call_dify_blocking(
            workflow_id=body.workflow_id,
            query=body.query,
            user=username,
            conversation_id=conversation_id,
            inputs=inputs,
            files=files_dicts,
        )
        # 落库用户消息 + 助手回复 + conversation_id
        try:
            session_store.append_message(session_id, username, "user", body.query)
            session_store.append_message(
                session_id, username, "assistant", result.get("answer", ""),
                conversation_id=result.get("conversation_id") or None,
            )
        except Exception:
            pass
        return ChatResponse(**result, session_id=session_id)
    except DifyAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


async def _stream_wrapper(body: ChatRequest, session_id: str, username: str,
                          conversation_id: str, files_dicts: list[dict], inputs: dict):
    """流式转发 Dify 并累积回答，结束后落库会话消息与 conversation_id。"""
    answer_parts: list[str] = []
    conv_id = conversation_id
    try:
        async for chunk in call_dify_streaming(
            workflow_id=body.workflow_id,
            query=body.query,
            user=username,
            conversation_id=conversation_id,
            inputs=inputs,
            files=files_dicts,
        ):
            yield chunk
            # 累积 answer 与 conversation_id（解析 Dify SSE data 行）
            for line in chunk.split("\n"):
                if line.startswith("data:"):
                    data_str = line[5:].strip()
                    if data_str and data_str != "[DONE]":
                        try:
                            obj = json.loads(data_str)
                            if obj.get("answer"):
                                answer_parts.append(obj["answer"])
                            if obj.get("conversation_id"):
                                conv_id = obj["conversation_id"]
                        except json.JSONDecodeError:
                            pass
    except DifyAPIError as e:
        yield f"event: error\ndata: {json.dumps({'message': e.message}, ensure_ascii=False)}\n\n"
    finally:
        # 落库（即使中途错误也保存已收到部分）
        try:
            session_store.append_message(session_id, username, "user", body.query)
            if answer_parts:
                session_store.append_message(
                    session_id, username, "assistant", "".join(answer_parts),
                    conversation_id=conv_id or None,
                )
        except Exception:
            pass
    # 回传 session_id 供前端维护当前会话
    yield f"event: session\ndata: {json.dumps({'session_id': session_id}, ensure_ascii=False)}\n\n"
