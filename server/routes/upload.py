"""
文件上传路由
  POST /api/upload → 保存文件到 uploads 目录，返回 upload_file_id 供聊天请求使用
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from auth.security import get_current_user, require_admin
from config import UPLOAD_DIR, MAX_UPLOAD_SIZE_MB, MAX_ICON_SIZE_MB, ALLOWED_MIME_TYPES, ALLOWED_ICON_TYPES

router = APIRouter(prefix="/api", tags=["Upload"])


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    # 校验文件类型
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {content_type or '未知'}",
        )

    # 校验文件大小
    max_size = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    size = 0
    upload_file_id = uuid.uuid4().hex
    ext = Path(file.filename or "file").suffix.lower()
    target = UPLOAD_DIR / f"{upload_file_id}{ext}"

    # 分块读取写入，同时累计大小做超限校验
    try:
        with target.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_size:
                    out.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"文件超过大小限制（最大 {MAX_UPLOAD_SIZE_MB}MB）",
                    )
                out.write(chunk)
    finally:
        await file.close()

    # 判断文件类型归属：图片 / 文档
    content_type_lower = content_type.lower()
    if content_type_lower.startswith("image/"):
        file_type = "image"
    else:
        file_type = "document"

    return {
        "id": upload_file_id,
        "upload_file_id": upload_file_id,
        "name": file.filename or "",
        "size": size,
        "type": file_type,
        "mime_type": content_type,
    }


@router.post("/upload/icon")
async def upload_icon(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_admin),
):
    """上传工作流图标：仅管理员，只允许图片(png/jpeg/gif/webp)，限制 3MB，返回可访问 URL。"""
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_ICON_TYPES:
        raise HTTPException(
            status_code=400,
            detail="仅支持 png/jpeg/gif/webp 图片格式",
        )

    max_size = MAX_ICON_SIZE_MB * 1024 * 1024
    size = 0
    upload_file_id = uuid.uuid4().hex
    ext_map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }
    ext = ext_map[content_type]
    target = UPLOAD_DIR / f"{upload_file_id}{ext}"

    try:
        with target.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_size:
                    out.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"图标超过大小限制（最大 {MAX_ICON_SIZE_MB}MB）",
                    )
                out.write(chunk)
    finally:
        await file.close()

    return {
        "url": f"/uploads/{upload_file_id}{ext}",
        "name": file.filename or "",
        "size": size,
        "mime_type": content_type,
    }
