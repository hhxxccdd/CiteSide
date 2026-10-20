# CiteSide

在 Chrome 侧栏阅读技术文章、提问、核对来源，再把有价值的回答整理进个人知识库。

CiteSide 将网页全文问答、个人知识库 RAG 和有次数上限的工具调用结合起来。资料不足时，模型可以搜索并阅读其他网页；用户确认后，回答才会保存为笔记，供之后检索。

> 当前是本地运行的单人版本。扩展界面名称、代码目录和 npm workspace 名称暂沿用 **ResearchFlow**。

## 可以做什么

| 功能 | 使用方式 |
| --- | --- |
| 围绕网页全文提问 | 打开普通技术文章，读取正文后直接提问，无需选中文字 |
| 组合多份资料 | 通过 `@` 或“添加资料”选择当前窗口的其他网页、指定个人笔记 |
| 检索个人知识库 | 对问题生成向量，用 pgvector 召回候选笔记，再由模型筛选相关内容 |
| 按资料缺口联网补查 | 模型选择搜索词和阅读目标，最多搜索 2 次、尝试阅读 3 篇网页 |
| 查看真实执行过程 | 流式显示答案，执行记录展示实际搜索词、结果链接、阅读目标和失败原因 |
| 停止与重试 | 随时停止，按原问题和原资料重试；生成中切换网页不会串用新页面 |
| 核对回答来源 | 悬停正文引用查看来源信息和片段，点击打开原网页或个人笔记 |
| 编辑并保存知识 | 修改标题和正文，确认后保存；支持笔记查看、筛选、修改和删除 |
| 恢复会话草稿 | 同窗口重开侧栏可恢复已暂存的问题、资料、最近完成回答和笔记编辑内容 |

默认使用当前网页、搜索个人知识库，联网默认关闭。三个范围开关相互独立；关闭知识库自动检索，仍可使用通过 `@` 明确指定的笔记。

## 一次研究任务怎样完成

```mermaid
flowchart TD
    A[网页正文、指定资料与问题] --> B[NestJS 固定本次任务和资料范围]
    B --> C[按开关检索个人笔记]
    C --> D[Qwen 判断资料是否足够]
    D -->|不足且允许联网| E[搜索或阅读网页]
    E --> D
    D -->|足够或达到次数上限| F[流式回答与来源引用]
    F --> G[用户编辑并确认保存]
    G --> H[生成向量并保存到 PostgreSQL]
    H -->|下次提问时检索| C
```

### 工具调用

Qwen 通过 `tool_calls` 请求工具，后端校验并执行，再把结果交给模型。第一轮结果偏题时，可以调整关键词补查，也可以换一篇网页阅读。

- 整次任务最多搜索 **2 次**、尝试阅读 **3 篇**，失败尝试也计入。
- 资料足够时提前回答，不要求用满次数。
- 重复搜索词、已尝试网页不重复执行；达到决策轮数上限后撤下工具收尾。
- 两轮来源合并去重，已有引用标识保持稳定；未读结果与已读正文分别标记。
- 关闭联网时不提供联网工具，后端也不执行联网操作。

### 个人知识库 RAG

保存笔记时，后端为标题和正文生成 **1024 维向量**。提问时按余弦距离召回最多 5 条候选，再由模型筛选最多 3 条相关笔记进入回答。

网页正文采用全文直传，当前没有网页分段索引或分层总结。网页和回答都不会自动入库，保存由用户确认。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 浏览器扩展 | Chrome Manifest V3、Side Panel、Storage、Scripting |
| 前端 | Vue 3、TypeScript、Vite、Headless UI |
| 内容处理 | Mozilla Readability、Turndown、Cheerio |
| 回答与编辑 | markdown-it、DOMPurify、Tiptap |
| 后端 | NestJS、TypeScript、Node.js |
| 数据库 | PostgreSQL、pgvector、node-postgres |
| 模型服务 | 阿里云百炼 Qwen、Embedding、联网搜索 |
| 流式通信 | POST + fetch 接收 SSE、eventsource-parser、AbortController |
| 回归测试 | Node.js Test Runner、本地 HTTP 模型与工具替身 |

## 项目结构

```text
apps/
  extension/
    public/manifest.json       扩展权限与入口配置
    src/
      background/              打开侧栏等后台入口
      features/
        page-context/          当前网页识别与正文读取
        research-materials/    @ 网页和笔记选择
        research-run/          任务、流式进度、引用与会话草稿
        knowledge-base/        笔记管理与共用编辑器
      shared/                  共用内容处理
  api/
    db/migrations/             数据库建表 SQL
    src/
      database/                PostgreSQL 连接
      llm/                     Qwen 请求、流式解析与取消
      knowledge/               笔记 CRUD、向量化与相关性筛选
      research/                任务编排、工具循环、来源与引用
        tools/                 知识库搜索、联网搜索、网页读取
    test/                      研究任务回归测试
docs/                          PRD、SDD、选型与问题复盘
```

`ResearchService` 组织任务，`ResearchToolRunner` 处理工具循环，具体工具各自负责外部调用。前端按功能目录组织，任务状态与正在浏览的页面分开保存。

## 本地启动

### 1. 准备环境和依赖

需要：

- Node.js 22.12+ 与 npm。
- Chrome 116+。
- 本机 PostgreSQL，当前项目使用 PostgreSQL 16，并已安装 pgvector。
- 可调用聊天、向量与联网接口的百炼 API Key。

```powershell
git clone https://github.com/hhxxccdd/CiteSide.git ResearchFlow
cd ResearchFlow
npm install
```

在根目录安装即可。npm workspaces 会一起安装 `apps/api` 和 `apps/extension` 中声明的依赖。

### 2. 初始化本机数据库

已有项目数据库和表时跳过初始化。

首次准备时，可以在 Navicat 中连接本机 PostgreSQL，用有创建权限的用户分别执行：

```sql
CREATE ROLE researchflow LOGIN PASSWORD 'your_local_password';
CREATE DATABASE researchflow OWNER researchflow;
```

密码请替换为自己设置的本机密码。随后用有扩展创建权限的用户连接 **researchflow 数据库**，启用已安装的 pgvector：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

再用准备填写到 `DATABASE_URL` 的项目用户连接该数据库，执行 [001_create_knowledge_entries.sql](apps/api/db/migrations/001_create_knowledge_entries.sql)。建表脚本用于首次初始化，已有表无需重复执行。

### 3. 配置后端

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

已有 `.env` 时直接检查配置，不需要覆盖。API Key 只填写在后端 `.env` 中，该文件已被 Git 忽略。

| 配置项 | 说明 |
| --- | --- |
| `PORT` | 默认 `3000`，当前扩展连接此端口 |
| `DATABASE_URL` | 本机 PostgreSQL 连接串，用户名、密码、端口需与实际一致 |
| `DASHSCOPE_API_KEY` | 百炼 API Key |
| `DASHSCOPE_BASE_URL` | 与 API Key 地域对应的兼容接口地址，以 `/compatible-mode/v1` 结尾 |
| `QWEN_CHAT_MODEL` | 聊天模型，示例为 `qwen-plus`；需支持当前工具调用和联网接口 |
| `EMBEDDING_MODEL` | 向量模型，示例为 `text-embedding-v4`；当前表与调用使用 1024 维 |
| `QWEN_MAX_OUTPUT_TOKENS` | 回答最大输出长度，默认 `8192`，不用于裁剪输入正文 |

例如：

```dotenv
DATABASE_URL=postgresql://researchflow:your_local_password@127.0.0.1:5432/researchflow
```

如果修改后端端口，还需要同步扩展中的 API 地址和主机权限。

### 4. 启动 API

```powershell
npm run dev:api
```

开发模式下修改后端源文件会自动重启。可以访问健康检查地址：

```text
http://127.0.0.1:3000/api/health
```

正常返回：

```json
{ "api": "ok", "database": "ok" }
```

该接口会检查数据库连接；连接不可用时返回 503。

### 5. 构建并加载扩展

另开一个终端，在项目根目录运行：

```powershell
npm run build -w @researchflow/extension
```

1. 打开 `chrome://extensions`，开启开发者模式。
2. 点击“加载已解压的扩展程序”。
3. 选择 **`apps/extension/dist` 整个文件夹**。
4. 打开普通 HTTP/HTTPS 技术文章，点击 ResearchFlow 图标。
5. 按提示授权，等正文读取完成后提问。

扩展修改后需要重新构建，并在扩展管理页点击“重新加载”。也可以持续监听构建：

```powershell
npm run dev:extension
```

监听构建仍需手动重新加载扩展，不是网页开发服务器的自动热更新。

## 常用命令与测试

以下命令均在项目根目录执行：

| 命令 | 作用 |
| --- | --- |
| `npm run dev:api` | 监听启动后端 |
| `npm run dev:extension` | 监听构建扩展 |
| `npm run build` | 构建后端和扩展 |
| `npm run build -w @researchflow/api` | 单独构建后端 |
| `npm run build -w @researchflow/extension` | 单独检查类型并构建扩展 |
| `npm run test:research-stream -w @researchflow/api` | 运行研究任务回归测试，需先有后端编译产物 |

```powershell
npm run build -w @researchflow/api
npm run test:research-stream -w @researchflow/api
```

当前包含 16 项回归测试，覆盖流式片段、工具参数、多轮补查、来源对应、次数限制、停止取消、提前断流、接口兼容、长文末尾传递和下载容量超限。测试使用本地 HTTP 模型与工具替身，不访问百炼、不写入真实知识库。

真实模型的可控场景检查与自动化测试范围不同，验证过程见 [联网问答问题复盘](docs/retrospective-web-search-and-follow-up.md)。

## 主要接口

默认地址为 `http://127.0.0.1:3000`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | API 与数据库健康检查 |
| POST | `/api/research/run/stream` | 研究任务 SSE 流式接口 |
| POST | `/api/research/run` | 同一任务的 JSON 接口，便于在 Apifox 调试 |
| POST | `/api/knowledge` | 确认保存笔记 |
| GET | `/api/knowledge?q=关键词` | 查看或按关键词筛选笔记 |
| GET | `/api/knowledge/search?q=问题` | 按问题向量检索并筛选相关笔记 |
| GET / PATCH / DELETE | `/api/knowledge/:id` | 查看、修改、删除单条笔记 |

研究请求使用 `question`、`materials`（`pages`、`noteIds`）和 `options`。请求示例及旧版单篇请求兼容规则见 [SDD-005](docs/SDD-005-research-materials.md#旧单篇接口兼容)。

## 当前范围与限制

- 一次提交完成一次研究任务，没有自动继承所有上一轮问答的聊天记忆。知识库 RAG 与界面草稿恢复是独立能力。
- 当前网页和指定网页的主要正文完整传递，取消了固定字符截断；浏览器提交正文合计与联网 HTML 下载各有 8 MiB 的资源上限，超限明确报错。模型上下文容量按实际服务端限制处理。
- 指定资料最多 3 篇网页、3 条笔记；联网读取仅接受本轮搜索所得网页。
- 服务端网页读取不执行 JavaScript，登录、验证或动态加载页面可能读取失败。浏览器内部页、PDF 等暂不支持。
- 切页保留本次任务快照；关闭侧栏会中断进行中的请求。草稿属于 Chrome 会话暂存，浏览器重启、扩展重载或容量不足时不保证恢复。
- 搜索结果、已读正文和实际引用分别记录。工具运行成功或出现引用标记，不等于所有结论都经过逐句核实。
- 当前不包含账号体系、跨设备同步、多 Agent、长期对话记忆或公开在线部署。

## 设计与复盘文档

| 文档 | 内容 |
| --- | --- |
| [PRD](docs/PRD.md) | 产品目标、功能范围与边界 |
| [数据库选型](docs/database-choice.md) | PostgreSQL、pgvector 与 MySQL 的取舍 |
| [SDD-001](docs/SDD-001-page-context.md) | 网页正文读取与权限 |
| [SDD-002](docs/SDD-002-single-task-agent.md) | 一次研究任务与联网补查循环 |
| [SDD-003](docs/SDD-003-knowledge-base.md) | 知识库、向量化与相关性筛选 |
| [SDD-004](docs/SDD-004-answer-rendering-and-citations.md) | Markdown 排版与自然文字引用 |
| [SDD-005](docs/SDD-005-research-materials.md) | 资料范围、@ 资料与切页状态 |
| [SDD-006](docs/SDD-006-long-document-processing.md) | 全文直传与资源限制 |
| [SDD-007](docs/SDD-007-streaming-research.md) | 流式进度、停止与重试 |
| [联网问答问题复盘](docs/retrospective-web-search-and-follow-up.md) | 问题现象、原因、解决过程与验证边界 |

## 分支约定

- `main`：已合并的项目版本。
- `develop`：后续开发的集成分支。
- 新功能从 `develop` 创建功能分支，完成验证后合并，并清理已合并的分支。
