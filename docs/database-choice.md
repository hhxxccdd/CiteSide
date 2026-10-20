# 数据库选型：PostgreSQL 与 MySQL 的取舍

ResearchFlow 第一版需要保存用户确认的笔记，并在下次提问时做简单向量检索。PostgreSQL 与现有 MySQL 都能保存笔记；选择 PostgreSQL，是因为 pgvector 能直接在本地数据库内完成向量存储和相似度排序。

1. **数据库内向量检索更完整。** 安装 pgvector 后，PostgreSQL 可以存储向量、计算相似度，并在需要时使用 HNSW 或 IVFFlat 索引。MySQL 较新版本也有 `VECTOR` 类型，但官方文档说明，`DISTANCE()` 不包含在普通 Community 发行版中。现有 MySQL 仍可保存向量，并让 NestJS 对少量资料计算相似度，只是后续扩展数据库内检索时需要重新评估方案。[pgvector 文档](https://github.com/pgvector/pgvector) · [MySQL 向量函数文档](https://dev.mysql.com/doc/refman/9.7/en/vector-functions.html)

2. **笔记与来源放在一起。** 一条笔记保存正文、向量和原网页信息。相似度搜索返回笔记时，也能取出来源，在侧栏展示可追溯的引用。[pgvector 查询示例](https://github.com/pgvector/pgvector#querying)

3. **代价是新增一套本地数据库。** 用户已有 MySQL，继续使用它能省去 PostgreSQL 的安装和维护。选择 PostgreSQL 后，Windows 本机要使用 pgvector 还需单独安装扩展；`CREATE EXTENSION vector;` 只是安装后的启用步骤。[pgvector 安装说明](https://github.com/pgvector/pgvector#installation)

**当前决定：**第一版使用 PostgreSQL + pgvector，每条短笔记一个向量，先做精确相似度搜索。暂不建设资料切片或近似索引，也不预设百万级性能收益。只有检索确实跑通后，演示和简历才宣称具备向量检索。
