"""
工作流管理路由
  - 列表 / 详情：登录用户可用（前端展示工作流）
  - 新增 / 修改 / 删除：仅管理员
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException

from auth.security import get_current_user, require_admin
from models.schemas import WorkflowPublic, WorkflowCreate, WorkflowUpdate
from services import workflow_store, conversation_store, knowledge_store, audit_log
from services.ragflow_service import test_connection, RAGFlowAPIError

router = APIRouter(prefix="/api/workflows", tags=["Workflows"])


def _strip_kb_info_for_user(workflow: dict) -> dict:
    """普通用户不可见知识库相关信息（数据集 ID / 文件绑定）。"""
    item = dict(workflow)
    item["ragDatasetIds"] = []
    item["ragBindings"] = []
    return item


def _fmt_bindings(workflow: dict) -> str:
    """格式化工作流知识库绑定，用于审计日志（不含 apiKey）。"""
    bindings = workflow.get("ragBindings") or []
    if bindings:
        parts = []
        for rb in bindings:
            docs = rb.get("documentIds") or []
            parts.append(f"知识库{rb.get('baseId')}/数据集{rb.get('datasetId')}/文件{docs}")
        return "；".join(parts)
    legacy = workflow.get("ragDatasetIds") or []
    return f"知识库(整库) {legacy}" if legacy else "无"


@router.get("", response_model=list[WorkflowPublic])
def list_workflows(current_user: dict = Depends(get_current_user)):
    # 只返回启用且不含 apiKey 的工作流
    wfs = workflow_store.list_workflows(include_api_key=False)
    enabled = [w for w in wfs if w.get("enabled", True)]
    if current_user["role"] == "admin":
        # 管理员始终可访问全部
        return enabled
    allowed = set(current_user.get("allowed_workflow_ids") or [])
    result = [w for w in enabled if w["id"] in allowed]
    # 普通用户隐藏知识库绑定信息
    return [_strip_kb_info_for_user(w) for w in result]


@router.get("/all", response_model=list[WorkflowPublic])
def list_all_workflows(_: dict = Depends(require_admin)):
    """管理员查看全部工作流（含未启用）。"""
    return workflow_store.list_workflows(include_api_key=False)


@router.get("/datasets")
def list_datasets(_: dict = Depends(require_admin)):
    """管理员获取可用的 RAGFlow 数据集列表，供工作流表单下拉多选。"""
    creds = knowledge_store.get_credentials()
    if creds is None:
        return {"connected": False, "datasets": [], "message": "RAGFlow 未配置或未启用，请先在「知识库管理」中配置"}
    try:
        result = asyncio.run(test_connection(creds["baseUrl"], creds["apiKey"]))
        return {
            "connected": result.get("connected", False),
            "datasets": result.get("datasets", []),
            "message": "连接成功" if result.get("connected") else "连接失败",
        }
    except RAGFlowAPIError as e:
        return {"connected": False, "datasets": [], "message": e.message}
    except Exception as e:  # noqa: BLE001
        return {"connected": False, "datasets": [], "message": f"获取数据集失败: {e}"}


@router.get("/{workflow_id}", response_model=WorkflowPublic)
def get_workflow(workflow_id: str, current_user: dict = Depends(get_current_user)):
    wf = workflow_store.get_workflow(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    wf.pop("apiKey", None)
    # 普通用户隐藏知识库绑定信息
    if current_user["role"] != "admin":
        return _strip_kb_info_for_user(wf)
    return wf


@router.post("", response_model=WorkflowPublic, status_code=201)
def create_workflow(body: WorkflowCreate, current_user: dict = Depends(require_admin)):
    try:
        result = workflow_store.create_workflow(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    audit_log.add_log(
        current_user["username"],
        "新增工作流",
        f"工作流「{result.get('name')}」(id={result.get('id')})，知识库绑定: {_fmt_bindings(result)}",
    )
    return result


@router.put("/{workflow_id}", response_model=WorkflowPublic)
def update_workflow(workflow_id: str, body: WorkflowUpdate, current_user: dict = Depends(require_admin)):
    result = workflow_store.update_workflow(workflow_id, body.model_dump(exclude_none=True))
    if result is None:
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    audit_log.add_log(
        current_user["username"],
        "修改工作流",
        f"工作流「{result.get('name')}」(id={result.get('id')})，知识库绑定: {_fmt_bindings(result)}",
    )
    return result


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, current_user: dict = Depends(require_admin)):
    if not workflow_store.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    audit_log.add_log(current_user["username"], "删除工作流", f"工作流 id={workflow_id}")
    # 清理该工作流的对话统计（保留记录但不级联删，简单起见不删）
