# AI 应用平台（void4 改造版）

基于 `void3/AI-Portal` 改造的 AI 门户平台。将原本纯前端 iframe 直接嵌入 Dify 的方式，升级为 **本地 FastAPI 后端封装 Dify API** + **用户/管理员双角色登录与权限体系**。

> `void3/AI-Portal` 保持原样不动，所有改造均在 `void4/` 下进行。

## 目录结构

```
void4/
├── README.md                    # 本说明
├── server/                      # FastAPI 后端
│   ├── main.py                  # 应用入口（注册路由、CORS、初始管理员引导）
│   ├── config.py                # 配置（端口、JWT、文件路径、CORS）
│   ├── requirements.txt         # 后端依赖
│   ├── .venv/                   # Python 虚拟环境（本地创建）
│   ├── data/
│   │   ├── users.json           # 用户账号（密码为 bcrypt 哈希）
│   │   ├── workflows.json       # 工作流配置（含 apiKey，仅后端可读）
│   │   └── conversations.json   # 对话记录（用于后台统计）
│   ├── auth/security.py         # JWT 签发校验、密码哈希、角色依赖
│   ├── models/schemas.py        # Pydantic 数据模型
│   ├── services/                # 存储服务 + Dify 封装
│   │   ├── dify_service.py      # Dify 对话调用（blocking/streaming）
│   │   ├── workflow_store.py    # workflows.json 读写
│   │   ├── user_store.py        # users.json 读写
│   │   └── conversation_store.py# 对话记录
│   └── routes/                  # auth / workflows / chat / accounts / dashboard
└── web/                         # 前端（由 void3 改造）
    ├── index.html               # 登录页 + 应用门户 + 管理后台 + 聊天面板
    ├── css/style.css            # 样式
    └── js/
        ├── auth.js              # token 管理、登录
        ├── api.js               # 封装后端 API 调用
        ├── apps.js              # 从后端动态加载工作流
        ├── chat.js              # 聊天面板（iframe）
        ├── admin.js             # 管理后台逻辑
        └── app.js               # 主逻辑（登录路由、权限控制、页面切换）
```

## 核心功能

### 登录与权限
- **登录**：用户名 + 密码，JWT Token 认证
- **管理员（admin）**：新增/编辑/删除工作流、账号管理（添加管理员/用户）、查看数据概览、查看对话记录
- **普通用户（user）**：仅能看到并使用启用的工作流进行对话，**无任何管理入口**，后端接口也强制 403 拦截

### 多工作流
- 管理员在**管理后台 → 工作流管理**中可视化新增/编辑/删除工作流，无需改代码
- 每个工作流可配置：名称、图标、类型（chatflow/workflow）、分类、描述、Dify API Key、Dify 地址、iframe 对话地址、是否启用
- 普通用户登录后自动看到已启用的工作流，点击卡片在 iframe 中对话

### Dify 封装
- 前端不再直接暴露 Dify token
- 后端通过保存的 `apiKey` 转发 Dify 对话（`POST /api/chat`），支持 blocking 与 streaming（SSE）
- `apiKey` 永不返回前端

## 快速开始

### 1. 启动后端

```bash
cd void4/server

# 首次：创建虚拟环境并安装依赖
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt   # Windows
# 或 source .venv/bin/activate && pip install -r requirements.txt  # Mac/Linux

# 启动服务
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8100
```

### 2. 启动前端（静态服务器）

```bash
cd void4/web
python -m http.server 8080
```

浏览器访问 `http://localhost:8080`。

### 3. 首次登录

- 首次启动后端会自动创建**初始管理员**账号：用户名 `admin` / 密码 `admin123`
- 用管理员登录后，建议立即在「账号管理」中修改密码或添加其他管理员/用户
- 用管理员登录后进入**管理后台**，先「新增工作流」配置好 Dify 应用

## 配置项

后端配置通过环境变量控制（见 `server/config.py`）：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | `8100` | 后端端口 |
| `CORS_ORIGINS` | localhost:3000/8080 等 | 允许的前端来源 |
| `SECRET_KEY` | 开发默认值 | **生产环境务必修改** |
| `INITIAL_ADMIN_USERNAME` | `admin` | 初始管理员用户名 |
| `INITIAL_ADMIN_PASSWORD` | `admin123` | 初始管理员密码 |

> ⚠️ 生产部署前请修改 `SECRET_KEY` 与初始管理员密码。

## 常见问题

- **新增工作流后用户看不到**：确认该工作流已勾选"启用"
- **对话报错**：确认该工作流的 `apiKey`、`baseUrl`（Dify 地址）、`type`（chatflow/workflow）填写正确
- **iframe 打不开**：确认 `iframeUrl` 是有效的 Dify Web App 地址（形如 `http://你的Dify地址/chatbot/xxx`）

## 后续规划（二期）

- RAGFlow 知识库接入 Dify（推荐采用 Dify「外部知识库 API」方式）
- 管理员后台新增「RAGFlow 知识库管理」模块，仅管理员可查看/修改/删除
