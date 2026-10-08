# 数据库选型：PostgreSQL 与 MySQL 的取舍

ResearchFlow 的 P0 需要保存网页资料、知识卡片和研究记录，PostgreSQL 与现有 MySQL 都能完成。我们选择 PostgreSQL，主要是为 P1 的资料切片向量检索留出更直接的实现路径，而不是因为 P0 离不开它。

1. **数据库内向量检索更完整。** 安装 pgvector 后，PostgreSQL 可以存储向量、计算相似度，并在需要时使用 HNSW 或 IVFFlat 索引。MySQL 较新版本也有 `VECTOR` 类型，但官方文档说明，`DISTANCE()` 不包含在普通 Community 发行版中。现有 MySQL 仍可保存向量，并让 NestJS 对少量资料计算相似度，只是后续扩展数据库内检索时需要重新评估方案。[pgvector 文档](https://github.com/pgvector/pgvector) · [MySQL 向量函数文档](https://dev.mysql.com/doc/refman/9.7/en/vector-functions.html)

2. **资料过滤与相似度排序可以放在同一条查询中。** P1 可以先限定某份收藏资料或标签，再找相似片段；检索结果也能直接关联到 Source，便于展示可追溯引用。这与项目的“查资料并给出来源”流程贴合。[pgvector 过滤示例](https://github.com/pgvector/pgvector#filtering)

3. **代价是新增一套本地数据库。** 用户已有 MySQL，继续使用它能省去 PostgreSQL 的安装和维护。选择 PostgreSQL 后，Windows 本机要使用 pgvector 还需单独安装扩展；`CREATE EXTENSION vector;` 只是安装后的启用步骤。[pgvector 安装说明](https://github.com/pgvector/pgvector#installation)

**当前决定：**P0 先用 PostgreSQL 完成资料与任务记录；P1 只有在基础流程稳定且 Embedding API 可用时才加入 pgvector。初期资料少，先做精确相似度搜索，不预设百万级性能收益，也不提前建设近似索引。若最终没有完成 P1，演示和简历不宣称项目具备向量检索。
