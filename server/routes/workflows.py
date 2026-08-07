"""
工作流管理路由
  - 列表 / 详情：登录用户可用（前端展示工作流）
  - 新增 / 修改 / 删除：仅管理员
"""
from fastapi import APIRouter, Depends, HTTPException

from auth.security import get_current_user, require_admin
from models.schemas import WorkflowPublic, WorkflowCreate, WorkflowUpdate
from services import workflow_store, audit_log

router = APIRouter(prefix="/api/workflows", tags=["Workflows"])


@router.get("", response_model=list[WorkflowPublic])
def list_workflows(current_user: dict = Depends(get_current_user)):
    # 只返回启用且不含 apiKey 的工作流
    wfs = workflow_store.list_workflows(include_api_key=False)
    enabled = [w for w in wfs if w.get("enabled", True)]
    if current_user["role"] == "admin":
        # 管理员始终可访问全部
        return enabled
    allowed = set(current_user.get("allowed_workflow_ids") or [])
    return [w for w in enabled if w["id"] in allowed]


@router.get("/all", response_model=list[WorkflowPublic])
def list_all_workflows(_: dict = Depends(require_admin)):
    """管理员查看全部工作流（含未启用）。"""
    return workflow_store.list_workflows(include_api_key=False)


@router.get("/{workflow_id}", response_model=WorkflowPublic)
def get_workflow(workflow_id: str, _: dict = Depends(get_current_user)):
    wf = workflow_store.get_workflow(workflow_id)
    if wf is None:
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    wf.pop("apiKey", None)
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
        f"工作流「{result.get('name')}」(id={result.get('id')})",
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
        f"工作流「{result.get('name')}」(id={result.get('id')})",
    )
    return result


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, current_user: dict = Depends(require_admin)):
    if not workflow_store.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    audit_log.add_log(current_user["username"], "删除工作流", f"工作流 id={workflow_id}")
