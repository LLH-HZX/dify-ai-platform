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
    # --- RAGFlow 检索相关 ---
    ragEnabled: bool = False        # 该工作流是否启用 RAGFlow 检索
    ragDatasetIds: list = []        # 使用的 RAGFlow 数据集 ID 列表
    ragTopK: int = 3                # 检索返回片段数
    ragContextVar: str = "context"  # 注入 Dify 的 inputs 变量名


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
    ragEnabled: Optional[bool] = None
    ragDatasetIds: Optional[list] = None
    ragTopK: Optional[int] = None
    ragContextVar: Optional[str] = None


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
    ragEnabled: bool = False
    ragDatasetIds: list = []
    ragTopK: int = 3
    ragContextVar: str = "context"
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
    query: str = Field(..., min_length=1)
    response_mode: str = "blocking"  # blocking | streaming
    conversation_id: str = ""
    inputs: Optional[dict] = None
    files: Optional[list[FileAttachment]] = None


class ChatResponse(BaseModel):
    answer: str
    reasoning_content: str = ""
    conversation_id: str = ""
    metadata: dict = {}


# ═══════════════════════════════════════
#  账号管理
# ═══════════════════════════════════════

class AccountCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    role: str = "user"  # admin | user


class AccountUpdate(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None


class AccountPublic(BaseModel):
    username: str
    role: str


# ═══════════════════════════════════════
#  后台统计
# ═══════════════════════════════════════

class DashboardStats(BaseModel):
    workflow_count: int
    user_count: int
    admin_count: int
    conversation_count: int


# ═══════════════════════════════════════
#  RAGFlow 知识库配置
# ═══════════════════════════════════════

class RAGFlowConfigPublic(BaseModel):
    baseUrl: str = ""
    enabled: bool = False
    # 不返回 apiKey


class RAGFlowConfigUpdate(BaseModel):
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None
    enabled: Optional[bool] = None


class RAGFlowConfig(BaseModel):
    connected: bool = False
    datasets: list = []
    message: str = ""
