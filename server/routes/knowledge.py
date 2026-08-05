"""
知识库管理路由（仅管理员）
  - 获取 / 保存 RAGFlow 全局配置
  - 测试 RAGFlow 连接并返回数据集列表
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.security import require_admin
from models.schemas import RAGFlowConfigPublic, RAGFlowConfigUpdate, RAGFlowConfig
from services import knowledge_store
from services.ragflow_service import test_connection, RAGFlowAPIError

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge"])


class TestConnectionBody(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""


@router.get("/config", response_model=RAGFlowConfigPublic)
def get_config(_: dict = Depends(require_admin)):
    """管理员查看 RAGFlow 全局配置（不返回 apiKey）。"""
    return knowledge_store.get_config(include_api_key=False)


@router.put("/config", response_model=RAGFlowConfigPublic)
def update_config(body: RAGFlowConfigUpdate, _: dict = Depends(require_admin)):
    """管理员保存 RAGFlow 全局配置。"""
    cfg = knowledge_store.save_config(body.model_dump(exclude_none=True))
    cfg.pop("apiKey", None)
    return cfg


@router.post("/test", response_model=RAGFlowConfig)
def test_ragflow(body: TestConnectionBody, _: dict = Depends(require_admin)):
    """测试 RAGFlow 连接，返回是否连通及可用数据集列表。"""
    import asyncio

    try:
        result = asyncio.run(test_connection(body.baseUrl, body.apiKey))
        return {
            "connected": result.get("connected", False),
            "datasets": result.get("datasets", []),
            "message": "连接成功" if result.get("connected") else "连接失败",
        }
    except RAGFlowAPIError as e:
        return {
            "connected": False,
            "datasets": [],
            "message": e.message,
        }
    except Exception as e:  # noqa: BLE001
        return {
            "connected": False,
            "datasets": [],
            "message": f"测试失败: {e}",
        }
