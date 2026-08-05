"""
认证安全模块：JWT 签发/校验、密码哈希、当前用户/管理员依赖
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from services.user_store import get_user

# 密码哈希（bcrypt）
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Bearer token 提取
bearer_scheme = HTTPBearer(auto_error=False)


# ═══════════════════════════════════════
#  密码工具
# ═══════════════════════════════════════

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


# ═══════════════════════════════════════
#  JWT 工具
# ═══════════════════════════════════════

def create_access_token(username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": username,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None


# ═══════════════════════════════════════
#  FastAPI 依赖
# ═══════════════════════════════════════

def _get_payload(credentials: Optional[HTTPAuthorizationCredentials]) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未提供认证凭据",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    """返回当前登录用户：{"username", "role", "allowed_workflow_ids"}"""
    payload = _get_payload(credentials)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Token 缺少用户信息")
    user = get_user(username)
    if user is None:
        raise HTTPException(status_code=401, detail="用户不存在")
    return {
        "username": user["username"],
        "role": user["role"],
        "allowed_workflow_ids": list(user.get("allowed_workflow_ids") or []),
    }


def require_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """仅管理员可访问的依赖"""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user
