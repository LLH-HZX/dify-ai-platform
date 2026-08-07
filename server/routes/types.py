"""
类型图标路由
  - GET /api/types/icons：登录用户可用，返回全部类型图标
  - PUT /api/types/icons/{type_name}：仅管理员，保存某类型图标
"""
from fastapi import APIRouter, Depends, HTTPException

from auth.security import get_current_user, require_admin
from models.schemas import TypeIconsPublic, TypeIconUpdate
from services import type_icon_store, audit_log

router = APIRouter(prefix="/api/types", tags=["Types"])

# 类型显示名映射（用于审计日志）
TYPE_LABELS = {"chatflow": "对话流", "workflow": "工作流", "agent": "智能体"}


@router.get("/icons", response_model=TypeIconsPublic)
def get_type_icons(_: dict = Depends(get_current_user)):
    """返回三种类型各自的图标 URL。"""
    return type_icon_store.get_type_icons()


@router.put("/icons/{type_name}", response_model=TypeIconsPublic)
def update_type_icon(
    type_name: str,
    body: TypeIconUpdate,
    current_user: dict = Depends(require_admin),
):
    """仅管理员：保存某类型的图标 URL（传空串表示清除）。"""
    if type_name not in type_icon_store.TYPE_KEYS:
        raise HTTPException(status_code=400, detail=f"未知类型: {type_name}")
    result = type_icon_store.set_type_icon(type_name, body.url)
    label = TYPE_LABELS.get(type_name, type_name)
    audit_log.add_log(
        current_user["username"],
        "设置类型图标",
        f"类型「{label}」图标 {'已清除' if not body.url else '已更新'}",
    )
    return result
