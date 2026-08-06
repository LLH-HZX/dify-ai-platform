# AI 应用平台（void5）

企业内部 AI 门户平台。基于 `void3/AI-Portal` 改造，由 **本地 FastAPI 后端封装 Dify API** + **用户/管理员双角色登录与权限体系**组成。相比前身 void4，新增了：站内聊天（含历史会话/续聊、文件附件）、RAGFlow 多知识库检索、多服务器知识库管理、操作日志等能力。

> `void3/AI-Portal` 保持原样不动，所有改造均在 `void5/` 下进行。

## 目录结构

```
void5/
├── README.md                    # 本说明
├── server/                      # FastAPI 后端
│   ├── main.py                  # 应用入口（注册路由、CORS、初始管理员引导）
│   ├── config.py                # 配置（端口、JWT、文件路径、CORS、RAGFlow、上传限制）
│   ├── requirements.txt         # 后端依赖
│   ├── .venv/                   # Python 虚拟环境（本地创建）
│   ├── data/                    # JSON 数据存储
│   │   ├── users.json           # 用户账号（密码为 bcrypt 哈希）
│   │   ├── workflows.json       # 工作流配置（含 apiKey，仅后端可读）
│   │   ├── conversations.json   # 对话记录（用于后台统计）
│   │   ├── sessions.json        # 历史会话（按用户隔离）
│   │   ├── ragflow_config.json  # RAGFlow 全局配置
│   │   ├── knowledge_bases.json # 知识库实体（多 RAGFlow 服务器）
│   │   └── audit_log.json       # 管理员操作日志
│   ├── uploads/                 # 聊天附件上传目录
│   ├── auth/security.py         # JWT 签发校验、密码哈希、角色依赖
│   ├── models/schemas.py        # Pydantic 数据模型
│   ├── services/                # 存储服务 + Dify/RAGFlow 封装
│   │   ├── dify_service.py      # Dify 对话调用（blocking/streaming）
│   │   ├── workflow_store.py    # workflows.json 读写
│   │   ├── user_store.py        # users.json 读写
│   │   ├── conversation_store.py# 对话记录
│   │   ├── session_store.py     # 历史会话读写（按用户名隔离）
│   │   ├── audit_log.py         # 操作日志读写
│   │   ├── knowledge_store.py   # RAGFlow 全局配置读写
│   │   ├── knowledge_bases.py   # 知识库实体读写
│   │   └── ragflow_service.py   # RAGFlow 检索/连接/文档列表封装
│   └── routes/                  # auth / workflows / chat / accounts / dashboard
│                               #  / knowledge / knowledge_bases / upload / sessions
└── web/                         # 前端（原生 JS）
    ├── index.html               # 登录页 + 应用门户 + 管理后台 + 聊天面板
    ├── css/style.css            # 样式
    └── js/
        ├── auth.js              # token 管理、登录
        ├── api.js               # 封装后端 API 调用 + SSE 解析
        ├── apps.js              # 从后端动态加载工作流
        ├── chat.js              # 站内聊天面板（发送、附件、历史会话/续聊）
        ├── admin.js             # 管理后台逻辑
        └── app.js               # 主逻辑（登录路由、权限控制、页面切换）
```

## 核心功能

### 登录与权限
- **登录**：用户名 + 密码，JWT Token 认证
- **管理员（admin）**：新增/编辑/删除工作流、知识库管理、账号管理（添加管理员/用户，并授权可用的工作流）、数据概览、操作日志
- **普通用户（user）**：仅能看到并使用已启用且被授权的工作流进行对话，**无任何管理入口**，后端接口也强制 403 拦截

### 多工作流
- 管理员在**管理后台 → 工作流管理**中可视化新增/编辑/删除工作流，无需改代码
- 每个工作流可配置：名称、图标、类型（chatflow/workflow）、分类、描述、Dify API Key、Dify 地址、是否启用、RAGFlow 检索开关与绑定知识库
- 账号可被授权使用指定的工作流；管理员角色不受限制

### 站内聊天（替代 iframe）
- 前端不再通过 iframe 直连 Dify，而是在**站内聊天面板**中通过后端转发对话，`apiKey` 永不返回前端
- 支持 **blocking 与 streaming（SSE）** 两种返回方式
- **历史会话与续聊**：聊天面板内置可折叠的「历史」侧栏，每次对话自动落库 `sessions.json`（按用户隔离），点击历史记录即可还原消息并继续对话（复用 `conversation_id` 续接 Dify 上下文）
- **文件附件**：支持上传图片/文档作为对话上下文（`POST /api/upload`，有类型与大小限制）

### RAGFlow 知识库检索
- **全局配置**（`/api/knowledge/config`）：管理员配置 RAGFlow 服务地址与 Key，并可在「数据概览 → 知识库管理」中查看/删除数据集
- **多服务器知识库实体**（`/api/knowledge-bases`）：每个知识库对应一个 RAGFlow 服务器（可各自不同的地址与 Key），由添加它的管理员管理；只有添加者可修改/删除，被工作流绑定的知识库禁止删除
- **工作流绑定**：工作流可勾选一个或多个知识库（可跨多个 RAGFlow 服务器、可精确到数据集甚至单个文档），聊天前先检索知识库并注入 `context` 变量再转发 Dify

### 管理后台
- **工作流管理**：可视化增删改查工作流
- **知识库管理**：多服务器知识库增删改查、连接测试
- **账号管理**：增删改查账号、重置密码、调整角色、授权可用工作流
- **数据概览**：工作流数 / 用户数 / 管理员数 / 对话次数统计，以及最近对话记录（工作流以名称显示）
- **操作日志**：记录管理员的后台配置操作，支持按**操作人 / 动作**筛选，日志中的工作流以名称显示

## 快速开始

### 1. 启动后端

```bash
cd void5/server

# 首次：创建虚拟环境并安装依赖
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt   # Windows
# 或 source .venv/bin/activate && pip install -r requirements.txt  # Mac/Linux

# 启动服务
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8100
```

### 2. 启动前端（静态服务器）

```bash
cd void5/web
python -m http.server 8080
```

浏览器访问 `http://localhost:8080`。

### 3. 首次登录

- 首次启动后端会自动创建**初始管理员**账号：用户名 `admin` / 密码 `admin123`
- 用管理员登录后，建议立即在「账号管理」中修改密码或添加其他管理员/用户
- 用管理员登录后进入**管理后台**，先「新增工作流」配置好 Dify 应用，再在「账号管理」中给用户授权

## 配置项

后端配置通过环境变量控制（见 `server/config.py`）：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | `8100` | 后端端口 |
| `CORS_ORIGINS` | localhost:3000/8080/8090 等 | 允许的前端来源 |
| `SECRET_KEY` | 开发默认值 | **生产环境务必修改** |
| `INITIAL_ADMIN_USERNAME` | `admin` | 初始管理员用户名 |
| `INITIAL_ADMIN_PASSWORD` | `admin123` | 初始管理员密码 |
| `MAX_UPLOAD_SIZE_MB` | `20` | 上传文件大小上限（MB） |
| `RAGFLOW_TIMEOUT` | `30` | RAGFlow 请求超时（秒） |
| `DIFY_TIMEOUT` | `120` | Dify 请求超时（秒） |

> ⚠️ 生产部署前请修改 `SECRET_KEY` 与初始管理员密码。

## API 概览

| 模块 | 路径前缀 | 说明 |
|------|---------|------|
| 认证 | `/api/auth` | 登录、当前用户 |
| 工作流 | `/api/workflows` | 工作流增删改查（管理员）、启用列表（用户） |
| 账号 | `/api/accounts` | 账号增删改查（管理员） |
| 对话 | `/api/chat` | 转发 Dify（blocking/streaming），可选 RAG 注入 |
| 会话 | `/api/sessions` | 历史会话列表/详情/删除（按用户隔离） |
| 数据概览 | `/api/dashboard` | 统计 / 最近对话 / 操作日志（管理员） |
| 知识库 | `/api/knowledge` | RAGFlow 全局配置、连接测试、删除数据集 |
| 知识库实体 | `/api/knowledge-bases` | 多服务器知识库管理（仅管理员） |
| 上传 | `/api/upload` | 文件上传（登录用户） |

## 常见问题

- **新增工作流后用户看不到**：确认该工作流已勾选"启用"，且该用户已在「账号管理」中被授权
- **对话报错**：确认该工作流的 `apiKey`、`baseUrl`（Dify 地址）、`type`（chatflow/workflow）填写正确
- **RAG 检索无效**：确认工作流已勾选"启用 RAGFlow 检索"、已绑定知识库，且知识库的地址与 Key 可连通
- **无法删除知识库/数据集**：该知识库正被某个工作流绑定，请先在这些工作流中移除绑定

## 后续规划（二期）

- RAGFlow 知识库更细粒度的权限与审计
- 管理员后台数据导出
- 对话用量/计费统计
