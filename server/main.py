"""
AI 门户 FastAPI 后端入口
  - 封装 Dify 对话 API
  - 用户 / 管理员 登录与权限控制
  - 工作流管理（管理员）
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import HOST, PORT, CORS_ORIGINS, INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, UPLOAD_DIR
from auth.security import hash_password
from services import user_store

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn.error")

# 首次启动若没有用户，则创建初始管理员
def _bootstrap_admin():
    if user_store.get_user(INITIAL_ADMIN_USERNAME) is None:
        try:
            user_store.create_user(INITIAL_ADMIN_USERNAME, hash_password(INITIAL_ADMIN_PASSWORD), "admin")
            logger.info(f"已创建初始管理员账号: {INITIAL_ADMIN_USERNAME}")
        except Exception as e:  # noqa: BLE001
            logger.warning(f"创建初始管理员失败: {e}")


_bootstrap_admin()

from routes.auth import router as auth_router
from routes.workflows import router as workflow_router
from routes.accounts import router as accounts_router
from routes.chat import router as chat_router
from routes.dashboard import router as dashboard_router
from routes.upload import router as upload_router
from routes.sessions import router as sessions_router
from routes.types import router as types_router

app = FastAPI(
    title="AI 应用平台 API",
    description="多工作流 AI 应用平台 — Dify 封装 / 登录权限 / 管理员后台",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.options("/{path:path}")
async def preflight_handler(path: str):
    return {}


@app.get("/api/health", tags=["Health"])
def health():
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(workflow_router)
app.include_router(accounts_router)
app.include_router(chat_router)
app.include_router(dashboard_router)
app.include_router(upload_router)
app.include_router(sessions_router)
app.include_router(types_router)

# 静态文件服务：允许前端通过 /uploads/xxx.png 访问上传的图片（图标等）
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
