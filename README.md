# ResearchFlow

Chrome 侧栏扩展与本地 API 的项目骨架。产品范围见 [PRD](docs/PRD.md)。
数据库选型及与 MySQL 的取舍见 [数据库选型说明](docs/database-choice.md)。
网页正文读取设计见 [SDD-001](docs/SDD-001-page-context.md)，单次提问任务设计见 [SDD-002](docs/SDD-002-single-task-agent.md)，知识库设计见 [SDD-003](docs/SDD-003-knowledge-base.md)，回答排版与正文引用见 [SDD-004](docs/SDD-004-answer-rendering-and-citations.md)。本轮资料范围、@ 网页与笔记、切页状态以及分步实施计划先看 [SDD-005](docs/SDD-005-research-materials.md)。

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

当前侧栏已支持自动读取当前网页正文、直接提问、查看一次性返回的回答和参考资料、编辑后确认保存笔记，以及在“我的知识”中查找、查看、修改和删除笔记。后端已支持知识库向量检索、按需联网搜索与网页阅读。第一版闭环接下来还要完成流式回答、真实进度和停止重试。API Key 只放在后端环境变量，不写入扩展或仓库。

## 新一轮设计与实现进度

当前已改为直接基于网页正文问答，不需要选中文字，也不显示正文预览。@ 当前窗口其他网页与笔记、知识库与联网范围开关、流式进度按 SDD-005 后续实施。不要把文档中的目标多资料接口当作现有接口。

### 当前网页全文问答

扩展构建后在管理页重新加载，打开普通技术文章、点击扩展图标，等“已读取网页正文”后直接输入问题。权限不足点击“授权并读取此站点”；无法取得标题和网址时点击“允许显示标签页信息”。仅读取不自动发给模型，点击开始研究才提交。

当前完整正文上限 30,000 字符，超出时明确提示并阻止提问，不截取开头假称全文。切换网页更新当前页信息，但已提交的任务继续使用原正文，保留回答与保存编辑内容。正文和回答不会自动存入知识库。

后端运行 npm run dev:api 时源文件修改会自动重启；若运行的是生产命令，需要重新构建并重启。当前 POST /api/research/run 接收 question 和 context，context 包含 title、url、text、capturedAt、completeness（必须是 full）。旧选区 truncated 字段已移除。
