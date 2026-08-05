"""
知识库实体管理路由（仅管理员）
  - 列表：所有管理员可见全部知识库（不含 apiKey）
  - 新增：任意管理员可添加（owner = 当前管理员）
  - 修改 / 删除：仅 owner（归属人）可操作
  - 删除保护：正被工作流绑定的知识库禁止删除
  - 测试连接：用某知识库自己的 url/key 测试并返回数据集列表
"""
import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.security import require_admin
from services import knowledge_bases, workflow_store, audit_log
from services.ragflow_service import test_connection, list_documents, RAGFlowAPIError

router = APIRouter(prefix="/api/knowledge-bases", tags=["KnowledgeBases"])


class BaseCreate(BaseModel):
    name: str
    baseUrl: str = ""
    apiKey: str = ""


class BaseUpdate(BaseModel):
    name: str | None = None
    baseUrl: str | None = None
    apiKey: str | None = None


def _require_owner(base_id: str, username: str) -> dict:
    """校验当前用户是否为该知识库的归属人；返回含 apiKey 的完整实体。"""
    base = knowledge_bases.get_full_base(base_id)
    if base is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if base.get("owner") != username:
        raise HTTPException(status_code=403, detail="只能修改/删除自己添加的知识库")
    return base


@router.get("")
def list_bases(_: dict = Depends(require_admin)):
    """所有管理员可见全部知识库（不返回 apiKey）。"""
    return knowledge_bases.list_bases(include_api_key=False)


@router.post("", status_code=201)
def create_base(body: BaseCreate, current_user: dict = Depends(require_admin)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="请输入知识库名称")
    if not body.baseUrl.strip() or not body.apiKey.strip():
        raise HTTPException(status_code=400, detail="请填写 RAGFlow 服务地址和 API Key")
    result = knowledge_bases.create_base({
        "name": body.name.strip(),
        "baseUrl": body.baseUrl.strip(),
        "apiKey": body.apiKey.strip(),
        "owner": current_user["username"],
    })
    audit_log.add_log(current_user["username"], "新增知识库", f"知识库「{result.get('name')}」(id={result.get('id')})")
    return result


@router.put("/{base_id}")
def update_base(base_id: str, body: BaseUpdate, current_user: dict = Depends(require_admin)):
    _require_owner(base_id, current_user["username"])
    result = knowledge_bases.update_base(base_id, body.model_dump(exclude_none=True))
    if result is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    audit_log.add_log(current_user["username"], "修改知识库", f"知识库「{result.get('name')}」(id={base_id})")
    return result


@router.delete("/{base_id}")
def delete_base(base_id: str, current_user: dict = Depends(require_admin)):
    _require_owner(base_id, current_user["username"])
    # 删除保护：正被工作流绑定的知识库禁止删除（同时检查旧 ragDatasetIds 与文件级 ragBindings）
    bindings = workflow_store.list_workflows(include_api_key=False)
    used_by = []
    for w in bindings:
        if base_id in (w.get("ragDatasetIds") or []):
            used_by.append(w)
            continue
        for rb in (w.get("ragBindings") or []):
            if rb.get("baseId") == base_id:
                used_by.append(w)
                break
    if used_by:
        names = "、".join(w.get("name") or w.get("id") for w in used_by)
        raise HTTPException(
            status_code=409,
            detail=f"该知识库正被工作流「{names}」使用，无法删除。请先在这些工作流中移除绑定。",
        )
    if not knowledge_bases.delete_base(base_id):
        raise HTTPException(status_code=404, detail="知识库不存在")
    audit_log.add_log(current_user["username"], "删除知识库", f"知识库 id={base_id}")
    return {"deleted": True, "base_id": base_id}


@router.post("/{base_id}/test")
def test_base(base_id: str, current_user: dict = Depends(require_admin)):
    """用知识库自己保存的 url/key 测试连接并返回其数据集列表。"""
    base = knowledge_bases.get_full_base(base_id)
    if base is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    try:
        result = asyncio.run(test_connection(base.get("baseUrl"), base.get("apiKey")))
        return {
            "connected": result.get("connected", False),
            "datasets": result.get("datasets", []),
            "message": "连接成功" if result.get("connected") else "连接失败",
        }
    except RAGFlowAPIError as e:
        return {"connected": False, "datasets": [], "message": e.message}
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "datasets": [], "message": f"测试失败: {e}"}


class TestConnectionBody(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""


@router.post("/test-connection")
def test_connection_preview(body: TestConnectionBody, _: dict = Depends(require_admin)):
    """新增/编辑知识库时，用表单当前填写的 url/key 测试连接并返回该服务器数据集列表。"""
    if not body.baseUrl.strip() or not body.apiKey.strip():
        return {"connected": False, "datasets": [], "message": "请先填写 RAGFlow 服务地址和 API Key"}
    try:
        result = asyncio.run(test_connection(body.baseUrl.strip(), body.apiKey.strip()))
        return {
            "connected": result.get("connected", False),
            "datasets": result.get("datasets", []),
            "message": "连接成功" if result.get("connected") else "连接失败",
        }
    except RAGFlowAPIError as e:
        return {"connected": False, "datasets": [], "message": e.message}
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "datasets": [], "message": f"测试失败: {e}"}


@router.get("/{base_id}/datasets")
def list_base_datasets(base_id: str, _: dict = Depends(require_admin)):
    """拉取某知识库实体的数据集列表（供文件绑定第一步展开）。"""
    base = knowledge_bases.get_full_base(base_id)
    if base is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    try:
        result = asyncio.run(test_connection(base.get("baseUrl"), base.get("apiKey")))
        return {
            "connected": result.get("connected", False),
            "datasets": result.get("datasets", []),
            "message": "连接成功" if result.get("connected") else "连接失败",
        }
    except RAGFlowAPIError as e:
        return {"connected": False, "datasets": [], "message": e.message}
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "datasets": [], "message": f"获取数据集失败: {e}"}


@router.get("/{base_id}/datasets/{dataset_id}/documents")
def list_base_documents(base_id: str, dataset_id: str, _: dict = Depends(require_admin)):
    """拉取某数据集下的文档列表（文件绑定第二步），返回 [{id, name}]。"""
    base = knowledge_bases.get_full_base(base_id)
    if base is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    try:
        documents = asyncio.run(list_documents(base.get("baseUrl"), base.get("apiKey"), dataset_id))
        return {"connected": True, "documents": documents, "message": "success"}
    except RAGFlowAPIError as e:
        return {"connected": False, "documents": [], "message": e.message}
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "documents": [], "message": f"拉取文档失败: {e}"}
