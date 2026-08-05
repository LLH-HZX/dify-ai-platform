"""
Dify API 调用服务

支持:
  - Chatflow & Workflow
  - blocking & streaming (SSE)
  - 文件上传代理 (POST /v1/files/upload)
"""
from __future__ import annotations

import json
from typing import AsyncGenerator, Optional

import httpx

from config import DIFY_TIMEOUT, DIFY_DEFAULT_USER
from services.workflow_store import get_workflow


class DifyAPIError(Exception):
    """Dify API 调用异常"""
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# ═══════════════════════════════════════
#  内部构建器
# ═══════════════════════════════════════

def _get_wf(workflow_id: str) -> dict:
    wf = get_workflow(workflow_id)
    if wf is None:
        raise DifyAPIError(f"工作流 '{workflow_id}' 不存在", 404)
    if not wf.get("apiKey"):
        raise DifyAPIError(f"工作流 '{workflow_id}' 未配置 API Key", 400)
    return wf


def _build_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _build_chat_body(query: str, user: str, conversation_id: str,
                     response_mode: str, inputs: dict, files: list[dict]) -> dict:
    body: dict = {
        "query": query,
        "user": user or DIFY_DEFAULT_USER,
        "response_mode": response_mode,
        "conversation_id": conversation_id or "",
        "inputs": inputs or {},
    }
    if files:
        body["files"] = files
    return body


def _build_workflow_body(query: str, user: str, response_mode: str,
                         inputs: dict, files: list[dict]) -> dict:
    merged = {**inputs, "query": query} if inputs else {"query": query}
    body: dict = {
        "inputs": merged,
        "user": user or DIFY_DEFAULT_USER,
        "response_mode": response_mode,
    }
    if files:
        body["files"] = files
    return body


def _serialize_files(files: list[dict]) -> list[dict]:
    result = []
    for f in files:
        result.append({
            "type": f.get("type", "image"),
            "transfer_method": f.get("transfer_method", "local_file"),
            "upload_file_id": f.get("upload_file_id", ""),
        })
    return result


# ═══════════════════════════════════════
#  阻塞模式
# ═══════════════════════════════════════

async def call_dify_blocking(
    workflow_id: str,
    query: str,
    user: str = "",
    conversation_id: str = "",
    inputs: dict | None = None,
    files: list[dict] | None = None,
) -> dict:
    wf = _get_wf(workflow_id)
    is_chatflow = wf["type"] == "chatflow"
    base_url = (wf.get("baseUrl") or "https://api.dify.ai").rstrip("/")

    url = f"{base_url}/v1/chat-messages" if is_chatflow else f"{base_url}/v1/workflows/run"
    headers = _build_headers(wf["apiKey"])
    files_payload = _serialize_files(files or [])

    if is_chatflow:
        body = _build_chat_body(query, user, conversation_id, "blocking", inputs or {}, files_payload)
    else:
        body = _build_workflow_body(query, user, "blocking", inputs or {}, files_payload)

    async with httpx.AsyncClient(timeout=DIFY_TIMEOUT, verify=False) as client:
        resp = await client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        _handle_error(resp)

    data = resp.json()

    if is_chatflow:
        return {
            "answer": data.get("answer", ""),
            "reasoning_content": data.get("reasoning_content", ""),
            "conversation_id": data.get("conversation_id", ""),
            "metadata": {},
        }

    outputs = data.get("data", {}).get("outputs", {})
    answer = outputs.get("text") or outputs.get("result") or outputs.get("output") or json.dumps(outputs, ensure_ascii=False)
    return {
        "answer": answer,
        "reasoning_content": data.get("reasoning_content", ""),
        "conversation_id": "",
        "metadata": {},
    }


# ═══════════════════════════════════════
#  流式模式
# ═══════════════════════════════════════

async def call_dify_streaming(
    workflow_id: str,
    query: str,
    user: str = "",
    conversation_id: str = "",
    inputs: dict | None = None,
    files: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    try:
        wf = _get_wf(workflow_id)
    except DifyAPIError as e:
        yield f"event: error\ndata: {json.dumps({'message': e.message})}\n\n"
        return

    is_chatflow = wf["type"] == "chatflow"
    base_url = (wf.get("baseUrl") or "https://api.dify.ai").rstrip("/")
    url = f"{base_url}/v1/chat-messages" if is_chatflow else f"{base_url}/v1/workflows/run"
    headers = _build_headers(wf["apiKey"])
    files_payload = _serialize_files(files or [])

    if is_chatflow:
        body = _build_chat_body(query, user, conversation_id, "streaming", inputs or {}, files_payload)
    else:
        body = _build_workflow_body(query, user, "streaming", inputs or {}, files_payload)

    async with httpx.AsyncClient(timeout=DIFY_TIMEOUT, verify=False) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            if resp.status_code != 200:
                error_text = await resp.aread()
                try:
                    error_data = json.loads(error_text)
                    msg = error_data.get("message", error_text)
                except json.JSONDecodeError:
                    msg = error_text[:500]
                yield f"event: error\ndata: {json.dumps({'message': msg})}\n\n"
                return

            async for line in resp.aiter_lines():
                if not line:
                    continue
                yield line + "\n"


# ═══════════════════════════════════════
#  错误处理
# ═══════════════════════════════════════

def _handle_error(resp) -> None:
    try:
        data = resp.json()
        message = data.get("message", resp.text)
    except Exception:
        message = resp.text[:500]
    raise DifyAPIError(message=message, status_code=resp.status_code)
