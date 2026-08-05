"""
工作流管理路由
  - 列表 / 详情：登录用户可用（前端展示工作流）
  - 新增 / 修改 / 删除：仅管理员
"""
from fastapi import APIRouter, Depends, HTTPException

from auth.security import get_current_user, require_admin
from models.schemas import WorkflowPublic, WorkflowCreate, WorkflowUpdate
from services import workflow_store, conversation_store

router = APIRouter(prefix="/api/workflows", tags=["Workflows"])


@router.get("", response_model=list[WorkflowPublic])
def list_workflows(_: dict = Depends(get_current_user)):
    # 只返回启用且不含 apiKey 的工作流
    wfs = workflow_store.list_workflows(include_api_key=False)
    return [w for w in wfs if w.get("enabled", True)]


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
def create_workflow(body: WorkflowCreate, _: dict = Depends(require_admin)):
    try:
        return workflow_store.create_workflow(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/{workflow_id}", response_model=WorkflowPublic)
def update_workflow(workflow_id: str, body: WorkflowUpdate, _: dict = Depends(require_admin)):
    result = workflow_store.update_workflow(workflow_id, body.model_dump(exclude_none=True))
    if result is None:
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    return result


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, _: dict = Depends(require_admin)):
    if not workflow_store.delete_workflow(workflow_id):
        raise HTTPException(status_code=404, detail=f"工作流 '{workflow_id}' 不存在")
    # 清理该工作流的对话统计（保留记录但不级联删，简单起见不删）
