"""
认证路由：登录、获取当前用户信息
"""
from fastapi import APIRouter, Depends, HTTPException

from auth.security import create_access_token, verify_password, get_current_user
from models.schemas import LoginRequest, TokenResponse, UserInfo
from services.user_store import get_user

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    user = get_user(body.username)
    if user is None or not verify_password(body.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token(user["username"], user["role"])
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserInfo)
def me(current_user: dict = Depends(get_current_user)):
    return UserInfo(username=current_user["username"], role=current_user["role"])
