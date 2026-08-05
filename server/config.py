"""
全局配置
"""
import os
from pathlib import Path

# ---------- 文件路径 ----------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
WORKFLOWS_JSON_PATH = DATA_DIR / "workflows.json"
USERS_JSON_PATH = DATA_DIR / "users.json"
CONVERSATIONS_JSON_PATH = DATA_DIR / "conversations.json"
RAGFLOW_CONFIG_JSON_PATH = DATA_DIR / "ragflow_config.json"
AUDIT_LOG_JSON_PATH = DATA_DIR / "audit_log.json"
KNOWLEDGE_BASES_JSON_PATH = DATA_DIR / "knowledge_bases.json"

# 确保目录存在
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ---------- 服务配置 ----------
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8100"))

# ---------- CORS ----------
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8080,http://127.0.0.1:8080,http://localhost:8090,http://127.0.0.1:8090",
).split(",")

# ---------- 认证 / JWT ----------
SECRET_KEY = os.getenv("SECRET_KEY", "please-change-me-to-a-random-secret-key")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

# ---------- 初始管理员 ----------
# 首次启动若 users.json 为空，将用下面的账号创建初始管理员
INITIAL_ADMIN_USERNAME = os.getenv("INITIAL_ADMIN_USERNAME", "admin")
INITIAL_ADMIN_PASSWORD = os.getenv("INITIAL_ADMIN_PASSWORD", "admin123")

# ---------- Dify ----------
DIFY_TIMEOUT = int(os.getenv("DIFY_TIMEOUT", "120"))
DIFY_DEFAULT_USER = os.getenv("DIFY_DEFAULT_USER", "web-user")

# ---------- RAGFlow ----------
RAGFLOW_TIMEOUT = int(os.getenv("RAGFLOW_TIMEOUT", "30"))
RAGFLOW_CONTEXT_VAR = os.getenv("RAGFLOW_CONTEXT_VAR", "context")
RAGFLOW_DEFAULT_TOP_K = int(os.getenv("RAGFLOW_DEFAULT_TOP_K", "3"))

# ---------- 上传 ----------
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "20"))
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
ALLOWED_FILE_TYPES = {
    "text/plain", "text/csv", "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/json",
}
ALLOWED_MIME_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_FILE_TYPES
