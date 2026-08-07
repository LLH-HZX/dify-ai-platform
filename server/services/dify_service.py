"""
Dify API 调用服务

支持:
  - Chatflow & Workflow
  - blocking & streaming (SSE)
  - 文件上传代理 (POST /v1/files/upload)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncGenerator, Optional

import httpx

from config import DIFY_TIMEOUT, DIFY_DEFAULT_USER, UPLOAD_DIR
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
    # workflow 类型的输入完全由前端表单/调用方传入的 inputs 决定，不强行注入 query
    body: dict = {
        "inputs": dict(inputs or {}),
        "user": user or DIFY_DEFAULT_USER,
        "response_mode": response_mode,
    }
    if files:
        body["files"] = files
    return body


def _resolve_local_file(upload_file_id: str) -> tuple[Path, str, str] | None:
    """根据平台 upload_file_id 在本地 uploads 目录查找真实文件。

    平台上传时用 upload_file_id 命名保存文件，扩展名未知，故用前缀匹配。
    返回 (文件路径, 原始文件名, mime_type)；找不到返回 None。
    """
    if not upload_file_id:
        return None
    for p in UPLOAD_DIR.glob(f"{upload_file_id}*"):
        if p.is_file():
            ext = p.suffix.lower()
            # 原始文件名退化为 id+ext；mime 通过扩展名粗判
            filename = p.name
            mime = {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".gif": "image/gif",
                ".pdf": "application/pdf",
                ".txt": "text/plain",
                ".doc": "application/msword",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xls": "application/vnd.ms-excel",
                ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".json": "application/json",
            }.get(ext, "application/octet-stream")
            return p, filename, mime
    return None


async def _upload_file_to_dify(base_url: str, api_key: str, user: str,
                               file_path: Path, filename: str, mime_type: str) -> str:
    """把平台本地文件上传到 Dify 的 /v1/files/upload，返回 Dify 文件 id。"""
    url = f"{base_url}/v1/files/upload"
    headers = {"Authorization": f"Bearer {api_key}"}
    # 读取文件字节（with 确保及时关闭句柄），再上传到 Dify
    with file_path.open("rb") as fh:
        file_bytes = fh.read()
    async with httpx.AsyncClient(timeout=DIFY_TIMEOUT, verify=False) as client:
        resp = await client.post(
            url,
            headers=headers,
            files={"file": (filename, file_bytes, mime_type), "user": (None, user)},
        )
    if resp.status_code not in (200, 201):
        try:
            data = resp.json()
            message = data.get("message", resp.text)
        except Exception:
            message = resp.text[:500]
        raise DifyAPIError(message=f"上传文件到 Dify 失败: {message}", status_code=resp.status_code)
    return resp.json().get("id", "")


async def _upload_files(base_url: str, api_key: str, user: str, files: list[dict]) -> list[dict]:
    """把传入的文件列表上传到 Dify（按当前工作流的 baseUrl/apiKey），替换为 Dify 真实 id。"""
    result = []
    for f in files or []:
        file_type = f.get("type", "image")
        transfer_method = f.get("transfer_method", "local_file")
        # 非 local_file（如 URL 引用）直接透传
        if transfer_method != "local_file":
            result.append({
                "type": file_type,
                "transfer_method": transfer_method,
                "upload_file_id": f.get("upload_file_id", ""),
            })
            continue
        local = _resolve_local_file(f.get("upload_file_id", ""))
        if local is None:
            # 本地找不到对应文件，跳过该文件（避免传无效 id）
            continue
        file_path, filename, mime = local
        did = await _upload_file_to_dify(base_url, api_key, user, file_path, filename, mime)
        if did:
            result.append({
                "type": file_type,
                "transfer_method": transfer_method,
                "upload_file_id": did,
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
    # chatflow / agent 都属于"对话类"应用，走 chat-messages；workflow 走 workflows/run
    is_chatflow = wf["type"] in ("chatflow", "agent")
    base_url = (wf.get("baseUrl") or "https://api.dify.ai").rstrip("/")

    url = f"{base_url}/v1/chat-messages" if is_chatflow else f"{base_url}/v1/workflows/run"
    headers = _build_headers(wf["apiKey"])
    # 先把平台本地文件上传到 Dify，替换为 Dify 真实文件 id
    files_payload = await _upload_files(base_url, wf["apiKey"], user or DIFY_DEFAULT_USER, files or [])

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

    is_chatflow = wf["type"] in ("chatflow", "agent")
    base_url = (wf.get("baseUrl") or "https://api.dify.ai").rstrip("/")
    url = f"{base_url}/v1/chat-messages" if is_chatflow else f"{base_url}/v1/workflows/run"
    headers = _build_headers(wf["apiKey"])
    # 先把平台本地文件上传到 Dify，替换为 Dify 真实文件 id
    try:
        files_payload = await _upload_files(base_url, wf["apiKey"], user or DIFY_DEFAULT_USER, files or [])
    except DifyAPIError as e:
        yield f"event: error\ndata: {json.dumps({'message': e.message}, ensure_ascii=False)}\n\n"
        return

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
