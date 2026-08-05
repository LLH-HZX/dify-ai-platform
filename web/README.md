# AI应用平台（前端 web）

由 `void3/AI-Portal` 改造而来的前端。现在**不再是纯前端 iframe 直连 Dify**，而是：
- 登录后从后端 API 动态获取工作流列表
- 普通用户使用工作流（iframe 对话），无管理权限
- 管理员可进入管理后台：工作流管理、账号管理、数据概览

## 运行依赖

需要先启动后端服务（见 `../README.md` 或 `../server/README`）。

## 本地运行

```bash
# 在 web 目录下启动静态服务器
python -m http.server 8080
```

浏览器访问 `http://localhost:8080`。

## 后端地址配置

前端默认访问 `http://127.0.0.1:8100`。如需修改，可在页面加载前设置全局变量：

```html
<script>window.API_BASE = 'http://127.0.0.1:8100';</script>
```

（需置于 `js/api.js` 加载之前）

## 目录结构

```
web/
├── index.html       # 登录页 + 应用门户 + 管理后台 + 聊天面板
├── css/style.css    # 样式
└── js/
    ├── auth.js      # token 管理、登录
    ├── api.js       # 封装后端 API 调用
    ├── apps.js      # 从后端动态加载工作流
    ├── chat.js      # 聊天面板（iframe）
    ├── admin.js     # 管理后台逻辑
    └── app.js       # 主逻辑
```
