"""
对话路由
  POST /api/chat → 转发到 Dify（blocking / streaming）
  转发前若工作流启用了 RAGFlow 检索，则先检索并注入上下文
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from auth.security import get_current_user
from models.schemas import ChatRequest, ChatResponse
from services import conversation_store, knowledge_store
from services.dify_service import call_dify_blocking, call_dify_streaming, DifyAPIError
from services.ragflow_service import retrieve, build_context, RAGFlowAPIError
from services.workflow_store import get_workflow

router = APIRouter(prefix="/api", tags=["Chat"])

logger = logging.getLogger("uvicorn.error")


async def _enrich_with_ragflow(workflow_id: str, query: str, inputs: dict | None) -> dict:
    """若工作流启用了 RAGFlow 检索，返回注入了上下文的 inputs；否则原样返回。"""
    inputs = dict(inputs or {})
    try:
        wf = get_workflow(workflow_id)
    except Exception:  # noqa: BLE001
        return inputs
    if wf is None or not wf.get("ragEnabled"):
        return inputs

    # 未配置全局 RAGFlow 凭证则不检索（静默降级）
    creds = knowledge_store.get_credentials()
    if creds is None:
        logger.warning("工作流 %s 启用了 RAGFlow，但全局 RAGFlow 未配置，跳过检索", workflow_id)
        return inputs

    dataset_ids = wf.get("ragDatasetIds") or []
    top_k = int(wf.get("ragTopK") or 3)
    context_var = wf.get("ragContextVar") or "context"

    try:
        chunks = await retrieve(
            base_url=creds["baseUrl"],
            api_key=creds["apiKey"],
            question=query,
            dataset_ids=dataset_ids,
            top_k=top_k,
        )
        context = build_context(chunks)
        if context:
            inputs[context_var] = context
            logger.info("工作流 %s 注入 RAGFlow 检索上下文：%d 个片段", workflow_id, len(chunks))
    except RAGFlowAPIError as e:
        # 检索失败不阻断主流程，仅记录
        logger.warning("RAGFlow 检索失败（工作流 %s）: %s", workflow_id, e.message)

    return inputs


@router.post("/chat")
async def send_message(body: ChatRequest, current_user: dict = Depends(get_current_user)):
    files_dicts = [f.model_dump() for f in (body.files or [])]
    username = current_user["username"]

    # 记录对话（用于后台统计）
    try:
        conversation_store.add_conversation(username, body.workflow_id, body.query)
    except Exception:
        # 统计失败不影响主流程
        pass

    # 注入 RAGFlow 检索上下文
    enriched_inputs = await _enrich_with_ragflow(body.workflow_id, body.query, body.inputs)

    if body.response_mode == "streaming":
        return StreamingResponse(
            _stream_wrapper(body, files_dicts, enriched_inputs),
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
            conversation_id=body.conversation_id,
            inputs=enriched_inputs,
            files=files_dicts,
        )
        return ChatResponse(**result)
    except DifyAPIError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


async def _stream_wrapper(body: ChatRequest, files_dicts: list[dict], inputs: dict):
    try:
        async for chunk in call_dify_streaming(
            workflow_id=body.workflow_id,
            query=body.query,
            user="web-user",
            conversation_id=body.conversation_id,
            inputs=inputs,
            files=files_dicts,
        ):
            yield chunk
    except DifyAPIError as e:
        yield f"event: error\ndata: {json.dumps({'message': e.message}, ensure_ascii=False)}\n\n"
