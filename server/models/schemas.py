"""
Pydantic 数据模型
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ═══════════════════════════════════════
#  认证
# ═══════════════════════════════════════

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserInfo(BaseModel):
    username: str
    role: str  # admin | user


# ═══════════════════════════════════════
#  工作流
# ═══════════════════════════════════════

class WorkflowBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: str = "🤖"
    description: str = ""
    type: str = "chatflow"  # chatflow | workflow
    category: str = "默认"
    apiKey: str = ""          # 仅管理员可见/填写
    baseUrl: str = ""         # Dify 服务地址
    iframeUrl: str = ""       # 前端聊天 iframe 地址（当前已不再使用，保留兼容）
    enabled: bool = True
    inputFields: list = []    # workflow 类型：输入变量定义 [{key,label,type,required}]


class WorkflowCreate(WorkflowBase):
    pass


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    category: Optional[str] = None
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    iframeUrl: Optional[str] = None
    enabled: Optional[bool] = None
    inputFields: Optional[list] = None


class WorkflowPublic(BaseModel):
    id: str
    name: str
    icon: str
    description: str
    type: str
    category: str
    baseUrl: str
    iframeUrl: str
    enabled: bool
    inputFields: list = []
    # 不返回 apiKey


# ═══════════════════════════════════════
#  对话
# ═══════════════════════════════════════

class FileAttachment(BaseModel):
    type: str = "image"
    transfer_method: str = "local_file"
    upload_file_id: str = ""


class ChatRequest(BaseModel):
    workflow_id: str = Field(..., min_length=1)
    # query 允许为空：chatflow 必须传，workflow 类型由 inputs 驱动、query 可为空
    query: str = ""
    response_mode: str = "blocking"  # blocking | streaming
    conversation_id: str = ""
    session_id: str = ""             # 前端打开历史会话时传入；空则自动新建会话
    inputs: Optional[dict] = None
    files: Optional[list[FileAttachment]] = None


class ChatResponse(BaseModel):
    answer: str
    reasoning_content: str = ""
    conversation_id: str = ""
    session_id: str = ""
    metadata: dict = {}


# ═══════════════════════════════════════
#  账号管理
# ═══════════════════════════════════════

class AccountCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    role: str = "user"  # admin | user
    allowed_workflow_ids: list = []  # 允许使用的（普通用户）工作流 id 列表，admin 忽略


class AccountUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
    allowed_workflow_ids: Optional[list] = None


class AccountPublic(BaseModel):
    username: str
    role: str
    allowed_workflow_ids: list = []


# ═══════════════════════════════════════
#  后台统计
# ═══════════════════════════════════════

class DashboardStats(BaseModel):
    workflow_count: int
    user_count: int
    admin_count: int
    conversation_count: int


# ═══════════════════════════════════════
#  类型图标
# ═══════════════════════════════════════

class TypeIconsPublic(BaseModel):
    chatflow: str = ""
    workflow: str = ""
    agent: str = ""


class TypeIconUpdate(BaseModel):
    url: str = ""  # 图标相对路径，如 /uploads/xxx.png；传空串表示清除



