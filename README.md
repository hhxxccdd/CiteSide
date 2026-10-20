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

当前侧栏已支持自动读取当前网页正文、直接提问、流式回答、真实工具进度、停止和按原资料重试、查看参考资料、编辑后确认保存笔记，以及在“我的知识”中查找、查看、修改和删除笔记。后端已支持知识库向量检索、按需联网搜索与网页阅读。API Key 只放在后端环境变量，不写入扩展或仓库。

## 新一轮设计与实现进度

当前已改为直接基于网页正文问答，不需要选中文字，也不显示正文预览。范围滑动开关、@ 当前窗口其他网页和指定笔记、流式进度与主动停止已接通。

### 当前网页全文问答

扩展构建后在管理页重新加载，打开普通技术文章、点击扩展图标，等“已读取网页正文”后直接输入问题。权限不足点击“授权并读取此站点”；无法取得标题和网址时点击“允许显示标签页信息”。仅读取不自动发给模型，点击开始研究才提交。

已取消三万字符限制，完整正文直接交给模型。单篇 8 MiB 正文是传输资源上限；服务端模型容量超限时明确提示，不悄悄截取。切换网页更新当前页信息，但已提交的任务继续使用原正文，保留回答与保存编辑内容。正文和回答不会自动存入知识库。

后端运行 npm run dev:api 时源文件修改会自动重启；若运行的是生产命令，需要重新构建并重启。当前 POST /api/research/run 接收 question、materials（pages 和 noteIds）、options。每篇正文包含 title、url、text、capturedAt、completeness（必须是 full）。旧版单篇 context 请求继续兼容，不能与 materials 同时提供；旧选区 truncated 字段已移除。

### 全文直传与界面简化

网页信息和问题输入合并为一张卡片，内部仍按组件分工。正文提取使用 Readability，格式转换使用 Turndown 和表格插件，替换手写节点转换逻辑。

[SDD-006](docs/SDD-006-long-document-processing.md) 已改为全文直传方案，取消网页分段 RAG、意图分流、分层总结和本地分词预算；个人知识库原有 RAG 保留。模型调用记录服务端实际用量；QWEN_MAX_OUTPUT_TOKENS 可配置回答长度，默认 8192。草稿恢复已完成，下一步是流式反馈。

### 资料范围与仅知识库问答

输入框下方提供“使用当前网页”“搜索个人知识库”“允许联网”三个滑动开关，默认前两项开启、联网关闭。网页未就绪时可以关闭“使用当前网页”，直接查个人笔记。没有指定资料且三个开关都关闭时不能提交；有指定笔记或其他网页时仍可提问。联网关闭后，后端不提供或执行联网工具；知识库关闭后跳过向量检索，但保留用户明确指定的笔记。

每次提交固定问题、正文和范围；切页或更改下一次提问的选项不改写旧答案。无网页来源的知识库笔记可从引用处打开详情，保存新问答时网页来源可留空。当前接口与 Apifox 示例见 SDD-005 末尾。

### @ 添加其他网页和指定笔记

在问题开头或空格后输入 @，或点击“添加资料”，选择当前窗口的其他 HTTP/HTTPS 网页或个人笔记。选择器使用 Headless UI，支持搜索、上下键、Enter 和 Escape。首次查看标签页列表可能需要授权；读取其他站点正文需要单独授权。未选中的网页不会读取正文。

最多使用 3 篇网页（包含当前网页）、3 条指定笔记；网页正文合计最多 8 MiB。指定网页会保留自己的正文快照，可以重新读取或移除；笔记由后端按 ID 读取最新版本。关闭知识库自动搜索仍会使用指定笔记。

如果“我的知识”提示无法连接服务，先启动 npm run dev:api，再点击重试；失败时不再同时显示“没有笔记”。

### 草稿和笔记编辑恢复

同窗口关闭再打开侧栏，会恢复未提交问题、范围开关、@ 资料、最近完成回答，以及保存笔记前修改的标题和正文。下一次问题与上一份回答分开保存，编辑草稿不会改变旧回答的来源；得到新回答时不会套用旧笔记编辑内容。

尚未读完的网页会提示重新读取；未完成的问答会提示重试，不自动请求模型或保存笔记。当前网页重新读取，固定的 @ 网页保留已有快照。恢复属于 Chrome 会话暂存，不是永久历史记录，浏览器重启或扩展重新加载后不承诺保留。

输入修改在 200ms 后暂存，开始问答、收到结果、页面隐藏时也会尝试写入。同一份正文只存一次。空间不足时会提示“重试暂存”；突然崩溃前尚未写完的修改可能丢失。关闭侧栏会取消后端模型和工具请求，重开不会自动重新执行。

验证方法：输入问题并添加资料，稍等片刻，关闭后重开侧栏；再修改一份回答的笔记标题和正文，关闭后重开，检查编辑内容仍在且没有自动入库。

保存前编辑和知识库修改均使用可视化正文编辑器，直接修改标题、段落、表格和代码，来源链接会保留。工具栏提供标题、加粗、列表、代码块、撤销和重做。共用组件为 knowledge-base/KnowledgeEditor.vue，按需加载；既有笔记和保存接口继续兼容。

### 流式、停止和重试

开始研究后，文字会随模型真实片段到达，执行记录只展示实际发生的步骤。新旧正文共用一个回答区，新片段在原位置替换旧正文。可点击“停止生成”；已收到的部分内容保留供查看，上一份完成回答和笔记编辑仍保留为备份，可在同一区域切回查看。

停止或失败后点击“按原资料重试”，会沿用原问题、网页快照、笔记 ID 和范围开关，创建新运行。切页或修改输入框不会改变这次重试。重开侧栏不会自动执行，仍可手动重试；不承诺恢复部分生成内容或永久执行记录。

流式接口：`POST http://127.0.0.1:3000/api/research/run/stream`，请求体与原 `/run` 相同，响应为 SSE。旧 JSON 接口继续可用。先构建后端，再运行 `npm run test:research-stream -w @researchflow/api` 可执行不联网、不写数据库的集成检查。详细说明见 [SDD-007](docs/SDD-007-streaming-research.md)。
