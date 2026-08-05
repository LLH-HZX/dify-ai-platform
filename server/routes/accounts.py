"""
账号管理路由（仅管理员）
  - 查看所有账号
  - 新增用户/管理员
  - 修改账号（重置密码 / 改角色）
  - 删除账号
"""
from fastapi import APIRouter, Depends, HTTPException

from auth.security import require_admin, hash_password
from models.schemas import AccountCreate, AccountUpdate, AccountPublic
from services import user_store, audit_log

router = APIRouter(prefix="/api/accounts", tags=["Accounts"])


@router.get("", response_model=list[AccountPublic])
def list_accounts(_: dict = Depends(require_admin)):
    return user_store.list_users(include_password=False)


@router.post("", response_model=AccountPublic, status_code=201)
def create_account(body: AccountCreate, current_user: dict = Depends(require_admin)):
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="角色必须是 admin 或 user")
    try:
        result = user_store.create_user(
            body.username,
            hash_password(body.password),
            body.role,
            allowed_workflow_ids=body.allowed_workflow_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    audit_log.add_log(
        current_user["username"],
        "新增账号",
        f"账号「{result.get('username')}」(角色={result.get('role')})，授权工作流: {result.get('allowed_workflow_ids') or []}",
    )
    return result


@router.put("/{username}", response_model=AccountPublic)
def update_account(username: str, body: AccountUpdate, current_user: dict = Depends(require_admin)):
    data = {}
    if body.password:
        data["password"] = hash_password(body.password)
    if body.role:
        if body.role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="角色必须是 admin 或 user")
        data["role"] = body.role
    if body.allowed_workflow_ids is not None:
        data["allowed_workflow_ids"] = body.allowed_workflow_ids

    result = user_store.update_user(username, data)
    if result is None:
        raise HTTPException(status_code=404, detail=f"账号 '{username}' 不存在")
    audit_log.add_log(
        current_user["username"],
        "修改账号",
        f"账号「{result.get('username')}」(角色={result.get('role')})，授权工作流: {result.get('allowed_workflow_ids') or []}",
    )
    return result


@router.delete("/{username}", status_code=204)
def delete_account(username: str, current_user: dict = Depends(require_admin)):
    if username == "admin":
        raise HTTPException(status_code=400, detail="不能删除初始管理员")
    if not user_store.delete_user(username):
        raise HTTPException(status_code=404, detail=f"账号 '{username}' 不存在")
    audit_log.add_log(current_user["username"], "删除账号", f"账号「{username}」")
