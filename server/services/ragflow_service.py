"""
RAGFlow 检索服务

封装 RAGFlow 的 HTTP 检索 API：
  POST {base_url}/api/v1/retrieval
  Header: Authorization: Bearer {api_key}
  Body: { question, dataset_ids, top_k, similarity_threshold, ... }

返回检索到的文档片段，供后端在转发 Dify 前注入上下文。
"""
from __future__ import annotations

import json
from typing import Optional

import httpx

from config import RAGFLOW_TIMEOUT


class RAGFlowAPIError(Exception):
    """RAGFlow API 调用异常"""
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


async def test_connection(base_url: str, api_key: str) -> dict:
    """测试 RAGFlow 连接：调用获取数据集列表接口验证地址与 Key 是否可用。

    优先用 /api/v1/datasets 验证；失败则尝试用 retrieval 接口探测。
    """
    base_url = (base_url or "").rstrip("/")
    if not base_url or not api_key:
        raise RAGFlowAPIError("RAGFlow 服务地址或 API Key 未配置", 400)

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # 1) 尝试拉取数据集列表（能校验地址 + Key + 拿到数据集ID）
    try:
        async with httpx.AsyncClient(timeout=RAGFLOW_TIMEOUT, verify=False) as client:
            resp = await client.get(f"{base_url}/api/v1/datasets", headers=headers, params={"page": 1, "page_size": 20})
        if resp.status_code == 200:
            data = resp.json()
            items = data.get("data", []) if isinstance(data, dict) else data
            if isinstance(items, list):
                datasets = []
                for d in items:
                    if isinstance(d, dict):
                        datasets.append({"id": d.get("id"), "name": d.get("name")})
                return {"connected": True, "datasets": datasets}
            return {"connected": True, "datasets": []}
        # 非 200：记录错误信息，继续尝试 retrieval 探测
        err = _extract_error(resp)
    except httpx.HTTPError as e:
        raise RAGFlowAPIError(f"无法连接 RAGFlow: {e}", 502)

    # 2) 用 retrieval 接口探测（针对不提供 datasets 列表接口的部署）
    try:
        body = {"question": "test", "dataset_ids": [], "top_k": 1}
        async with httpx.AsyncClient(timeout=RAGFLOW_TIMEOUT, verify=False) as client:
            resp = await client.post(f"{base_url}/api/v1/retrieval", headers=headers, json=body)
        if resp.status_code == 200:
            return {"connected": True, "datasets": [], "note": "连接成功（retrieval 可用）"}
        raise RAGFlowAPIError(_extract_error(resp), resp.status_code)
    except httpx.HTTPError as e:
        raise RAGFlowAPIError(f"无法连接 RAGFlow: {e}; datasets 接口: {err}", 502)


async def retrieve(
    base_url: str,
    api_key: str,
    question: str,
    dataset_ids: list[str] | None = None,
    top_k: int = 3,
    similarity_threshold: float = 0.2,
) -> list[dict]:
    """调用 RAGFlow 检索接口，返回文档片段列表。

    每个片段为 dict，含 content / score / document_name 等字段。
    """
    base_url = (base_url or "").rstrip("/")
    if not base_url or not api_key:
        raise RAGFlowAPIError("RAGFlow 服务地址或 API Key 未配置", 400)

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "question": question,
        "dataset_ids": dataset_ids or [],
        "top_k": int(top_k),
        "similarity_threshold": float(similarity_threshold),
    }

    try:
        async with httpx.AsyncClient(timeout=RAGFLOW_TIMEOUT, verify=False) as client:
            resp = await client.post(f"{base_url}/api/v1/retrieval", headers=headers, json=body)
    except httpx.HTTPError as e:
        raise RAGFlowAPIError(f"调用 RAGFlow 检索失败: {e}", 502)

    if resp.status_code != 200:
        raise RAGFlowAPIError(_extract_error(resp), resp.status_code)

    data = resp.json()
    chunks = data.get("data", {}).get("chunks", []) if isinstance(data, dict) else []

    results = []
    for c in chunks:
        if not isinstance(c, dict):
            continue
        results.append({
            "content": c.get("content", c.get("content_with_weight", "")),
            "score": c.get("similarity", c.get("score", 0)),
            "document_name": c.get("document_name", c.get("document_keyword", "")),
            "dataset_name": c.get("dataset_name", ""),
        })
    return results


def build_context(chunks: list[dict], max_chars: int = 12000) -> str:
    """把检索到的片段拼成注入 Dify 的上下文文本。

    默认 12000 字符；若 Dify 端 context 变量为"段落"类型（可设到 30000），
    后端可继续加大该值。若 Dify 端是 string 类型（限 256），需改小。
    """
    if not chunks:
        return ""
    parts = []
    used = 0
    for idx, c in enumerate(chunks, 1):
        content = (c.get("content") or "").strip()
        if not content:
            continue
        snippet = content
        # 控制总长度，防止超出 Dify 输入限制
        remaining = max_chars - used
        if len(snippet) > remaining:
            snippet = snippet[:remaining]
        source = c.get("document_name") or c.get("dataset_name") or "未知来源"
        parts.append(f"[{idx}] 来源：{source}\n{snippet}")
        used += len(snippet)
        if used >= max_chars:
            break
    return "\n\n".join(parts)


def _extract_error(resp) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict):
            return data.get("message") or data.get("detail") or resp.text[:500]
        return resp.text[:500]
    except Exception:
        return resp.text[:500]
