"""
知识库管理路由（仅管理员）
  - 获取 / 保存 RAGFlow 全局配置
  - 测试 RAGFlow 连接并返回数据集列表
  - 删除 RAGFlow 数据集（带删除保护：被工作流绑定的数据集禁止删除）
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.security import require_admin
from models.schemas import RAGFlowConfigPublic, RAGFlowConfigUpdate, RAGFlowConfig
from services import knowledge_store, workflow_store, audit_log
from services.ragflow_service import test_connection, RAGFlowAPIError

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge"])


class TestConnectionBody(BaseModel):
    baseUrl: str = ""
    apiKey: str = ""


def _find_bindings(dataset_id: str) -> list[dict]:
    """找出所有绑定了该数据集的启用工作流。"""
    wfs = workflow_store.list_workflows(include_api_key=False)
    return [w for w in wfs if dataset_id in (w.get("ragDatasetIds") or [])]


@router.get("/config", response_model=RAGFlowConfigPublic)
def get_config(_: dict = Depends(require_admin)):
    """管理员查看 RAGFlow 全局配置（不返回 apiKey）。"""
    return knowledge_store.get_config(include_api_key=False)


@router.put("/config", response_model=RAGFlowConfigPublic)
def update_config(body: RAGFlowConfigUpdate, current_user: dict = Depends(require_admin)):
    """管理员保存 RAGFlow 全局配置。"""
    cfg = knowledge_store.save_config(body.model_dump(exclude_none=True))
    audit_log.add_log(
        current_user["username"],
        "修改知识库配置",
        f"baseUrl={cfg.get('baseUrl')}，enabled={cfg.get('enabled')}",
    )
    cfg.pop("apiKey", None)
    return cfg


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, current_user: dict = Depends(require_admin)):
    """删除 RAGFlow 数据集。若该数据集正被某个工作流绑定，则禁止删除。"""
    # 删除保护：检查是否被工作流绑定
    bindings = _find_bindings(dataset_id)
    if bindings:
        names = "、".join(w.get("name") or w.get("id") for w in bindings)
        raise HTTPException(
            status_code=409,
            detail=f"该知识库正被工作流「{names}」使用，无法删除。请先在这些工作流中移除绑定。",
        )

    creds = knowledge_store.get_credentials()
    if creds is None:
        raise HTTPException(status_code=400, detail="RAGFlow 未配置或未启用，无法删除数据集")

    # 调用 RAGFlow 删除数据集接口
    import httpx

    from config import RAGFLOW_TIMEOUT

    base_url = (creds["baseUrl"] or "").rstrip("/")
    headers = {"Authorization": f"Bearer {creds['apiKey']}", "Content-Type": "application/json"}
    try:
        import asyncio

        async def _do():
            async with httpx.AsyncClient(timeout=RAGFLOW_TIMEOUT, verify=False) as client:
                return await client.delete(f"{base_url}/api/v1/datasets/{dataset_id}", headers=headers)

        resp = asyncio.run(_do())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"调用 RAGFlow 删除失败: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"删除数据集失败: {resp.text[:300]}")

    audit_log.add_log(current_user["username"], "删除知识库", f"数据集 id={dataset_id}")
    return {"deleted": True, "dataset_id": dataset_id}


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
