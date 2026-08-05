"""
后台统计路由（仅管理员）
  GET /api/dashboard/stats → 工作流数 / 用户数 / 管理员数 / 对话次数
  GET /api/dashboard/recent  → 最近对话记录
"""
from fastapi import APIRouter, Depends

from auth.security import require_admin
from models.schemas import DashboardStats
from services import workflow_store, user_store, conversation_store

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=DashboardStats)
def stats(_: dict = Depends(require_admin)):
    return DashboardStats(
        workflow_count=len(workflow_store.list_workflows(include_api_key=False)),
        user_count=user_store.count_by_role("user"),
        admin_count=user_store.count_by_role("admin"),
        conversation_count=conversation_store.count_all(),
    )


@router.get("/recent")
def recent(limit: int = 50, _: dict = Depends(require_admin)):
    return conversation_store.list_recent(limit=limit)
