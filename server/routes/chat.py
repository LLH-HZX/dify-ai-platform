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
from services import conversation_store, knowledge_store, knowledge_bases, session_store
from services.dify_service import call_dify_blocking, call_dify_streaming, DifyAPIError
from services.ragflow_service import retrieve, build_context, RAGFlowAPIError
from services.workflow_store import get_workflow

router = APIRouter(prefix="/api", tags=["Chat"])

logger = logging.getLogger("uvicorn.error")


async def _retrieve_from_base(
    base: dict,
    query: str,
    dataset_ids: list[str],
    top_k: int,
    document_ids: list[str] | None = None,
) -> list[dict]:
    """调用某个知识库实体（其自有 url/key）检索，返回片段列表。

    document_ids 非空时按文档过滤，实现「只检索勾选的文件」。
    """
    try:
        return await retrieve(
            base_url=base.get("baseUrl"),
            api_key=base.get("apiKey"),
            question=query,
            dataset_ids=dataset_ids,
            top_k=top_k,
            document_ids=document_ids,
        )
    except RAGFlowAPIError as e:
        logger.warning("知识库「%s」检索失败: %s", base.get("name"), e.message)
        return []


async def _enrich_with_ragflow(workflow_id: str, query: str, inputs: dict | None) -> dict:
    """若工作流启用了 RAGFlow 检索，返回注入了上下文的 inputs；否则原样返回。

    工作流可绑定多个知识库实体（可跨多个 RAGFlow 服务器），逐个服务器检索后合并上下文。
    """
    inputs = dict(inputs or {})
    try:
        wf = get_workflow(workflow_id)
    except Exception:  # noqa: BLE001
        return inputs
    if wf is None or not wf.get("ragEnabled"):
        return inputs

    top_k = int(wf.get("ragTopK") or 3)
    context_var = wf.get("ragContextVar") or "context"

    # 优先：知识库绑定（ragBindings）——逐知识库实体、逐数据集检索。
    # documentIds 为空（整库绑定）时对整个数据集检索；非空时按文档过滤检索（兼容旧数据）。
    bindings = wf.get("ragBindings") or []
    if bindings:
        all_chunks = []
        used_bases = 0
        for rb in bindings:
            base = knowledge_bases.get_full_base(rb.get("baseId"))
            if base is None:
                continue
            dataset_id = rb.get("datasetId") or ""
            document_ids = rb.get("documentIds") or []
            chunks = await _retrieve_from_base(
                base, query, [dataset_id] if dataset_id else [], top_k,
                document_ids=document_ids or None,
            )
            all_chunks.extend(chunks)
            used_bases += 1
        context = build_context(all_chunks)
        if context:
            inputs[context_var] = context
            logger.info("工作流 %s 注入知识库检索上下文：%d 个片段（%d 个绑定）", workflow_id, len(all_chunks), used_bases)
        return inputs

    # 兼容旧数据：ragDatasetIds（知识库实体 id 数组，整库检索）
    base_ids = wf.get("ragDatasetIds") or []
    if base_ids:
        bases = []
        unresolved = []
        for bid in base_ids:
            b = knowledge_bases.get_full_base(bid)
            if b is not None:
                bases.append(b)
            else:
                unresolved.append(bid)
        if bases:
            all_chunks = []
            for b in bases:
                chunks = await _retrieve_from_base(b, query, [], top_k)
                all_chunks.extend(chunks)
            context = build_context(all_chunks)
            if context:
                inputs[context_var] = context
                logger.info("工作流 %s 注入知识库检索上下文：%d 个片段（%d 个知识库）", workflow_id, len(all_chunks), len(bases))
            return inputs
        # 没有命中任何知识库实体：退化为旧逻辑（全局 RAGFlow + 这些 id 作为数据集 id）
        if unresolved:
            dataset_ids = unresolved
            return await _enrich_legacy(wf, query, inputs, dataset_ids, top_k, context_var)
        return inputs

    # 未绑定任何知识库：退化为旧逻辑（全局 RAGFlow + 空数据集）
    return await _enrich_legacy(wf, query, inputs, [], top_k, context_var)


async def _enrich_legacy(wf: dict, query: str, inputs: dict, dataset_ids: list[str], top_k: int, context_var: str) -> dict:
    """旧逻辑：用全局 RAGFlow 配置检索（兼容历史数据）。"""
    creds = knowledge_store.get_credentials()
    if creds is None:
        logger.warning("工作流 %s 启用了 RAGFlow，但全局 RAGFlow 未配置，跳过检索", wf.get("id"))
        return inputs
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
            logger.info("工作流 %s 注入全局 RAGFlow 检索上下文：%d 个片段", wf.get("id"), len(chunks))
    except RAGFlowAPIError as e:
        logger.warning("RAGFlow 检索失败（工作流 %s）: %s", wf.get("id"), e.message)
    return inputs


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

    # 注入 RAGFlow 检索上下文
    enriched_inputs = await _enrich_with_ragflow(body.workflow_id, body.query, body.inputs)

    if body.response_mode == "streaming":
        return StreamingResponse(
            _stream_wrapper(body, session_id, username, conversation_id, files_dicts, enriched_inputs),
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
            inputs=enriched_inputs,
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
