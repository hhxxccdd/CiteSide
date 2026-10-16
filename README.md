# ResearchFlow

Chrome 侧栏扩展与本地 API 的项目骨架。产品范围见 [PRD](docs/PRD.md)。
数据库选型及与 MySQL 的取舍见 [数据库选型说明](docs/database-choice.md)。
选区与侧栏预览设计见 [SDD-001](docs/SDD-001-page-context.md)，单次提问任务设计见 [SDD-002](docs/SDD-002-single-task-agent.md)，知识库设计见 [SDD-003](docs/SDD-003-knowledge-base.md)。

## 目录

- `apps/extension`：Vue 3 + TypeScript + Vite，打包为 Manifest V3 扩展。
- `apps/api`：NestJS API，使用 `pg` 连接 PostgreSQL。
- `compose.yaml`：本地 PostgreSQL。

## 本地启动

需要 Node.js 20.19+ 和 npm。PostgreSQL 可以直接安装在 Windows，也可以用 Docker 启动，任选一种。

先安装依赖并准备 API 配置：

```powershell
npm install
Copy-Item apps/api/.env.example apps/api/.env
```

### 方式一：Windows 本机安装 PostgreSQL

从 [PostgreSQL Windows 下载页](https://www.postgresql.org/download/windows/)获取安装程序。安装时记住 `postgres` 管理员密码，端口可保留默认的 `5432`。安装完成后，以 `postgres` 用户连接到 `postgres` 数据库，在 pgAdmin 或 SQL Shell（psql）中依次单独执行这两条 SQL：

```sql
CREATE ROLE researchflow LOGIN PASSWORD 'researchflow';
CREATE DATABASE researchflow OWNER researchflow;
```

若你为项目用户设置了其他密码，修改 `apps/api/.env` 中的 `DATABASE_URL`。如果本机 PostgreSQL 使用了其他端口，也要同步修改 URL 中的端口。此方式不需要运行 Docker 命令。

### 方式二：Docker 启动 PostgreSQL

启动 Docker Desktop，然后运行：

```powershell
npm run db:up
```

容器会自动创建与 `apps/api/.env.example` 一致的项目用户和数据库。

### 启动 API 与扩展

数据库就绪后运行：

```powershell
npm run dev:api
```

另开一个终端打包扩展：

```powershell
npm run build -w @researchflow/extension
```

打包结果位于 `apps/extension/dist`，其中包含 Chrome 需要的 `manifest.json`、`background.js`、`sidepanel.html` 和前端资源。打开 `chrome://extensions`，开启开发者模式，点击“加载已解压的扩展程序”，**选择整个 `apps/extension/dist` 文件夹**。点击扩展图标可打开侧栏。本地演示无需生成 `.crx` 文件，也无需上传 Chrome 网上应用店。

API 健康检查：`http://127.0.0.1:3000/api/health`。该接口同时检查 PostgreSQL 连接；数据库未启动时会返回 503。

修改扩展代码后重新构建，并在 `chrome://extensions` 点击刷新。也可运行 `npm run dev:extension` 持续构建，然后手动刷新扩展。

当前侧栏已支持选区预览、确认、提问、查看一次性返回的回答和参考资料、编辑后确认保存笔记，以及在“我的知识”中查找、查看、修改和删除笔记。后端已支持知识库向量检索、按需联网搜索与网页阅读。第一版闭环接下来还要完成流式回答、真实进度和停止重试。API Key 只放在后端环境变量，不写入扩展或仓库。
