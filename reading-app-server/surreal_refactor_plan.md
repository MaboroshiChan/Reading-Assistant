# SurrealDB 重构计划书 (Surreal Refactor Plan)

## 1. 核心目标
*   **架构升级**：从基于 JSON 文件的本地存储迁移到原生支持图（Graph）和向量（Vector）的 SurrealDB。
*   **成本优化**：引入对话模式（Chat Session），利用 KV Caching 降低 Token 消耗。
*   **能力增强**：实现跨章节、跨书籍的实体自动查重与关系合并，构建真正的个人知识图谱。

## 2. 详细路线图

### Phase 1: 基础设施集成 (Completed: 50%)
- [x] 安装 SurrealDB (brew) 与 SDK (npm)。
- [x] 创建 `SurrealModule` 和 `SurrealService` 实现基础连接。
- [x] 在 `AppModule` 中注册全局模块。
- [ ] 在 `.env` 中配置数据库连接参数（URL, Namespace, Database, Credentials）。

### Phase 2: 数据模型定义 (Schema Design)
- [ ] 编写 SurrealQL 初始化脚本，定义以下核心表：
    - **节点表**：`person`, `event`, `concept`, `theme`, `book`, `chapter`。
    - **边表 (Relations)**：`knows`, `involved_in`, `appears_in`, `part_of`, `related_to`。
- [ ] 定义索引：
    - 在 `person.name` 和 `aliases` 上建立全文本搜索索引 (FTS)。
    - 在实体描述上建立向量索引 (MTREE)，用于语义查重。

### Phase 3: LLM 提取逻辑重构 (The Dialogue Mode)
- [ ] **`llmService.ts` 升级**：
    - 实现 `startChatSession(systemPrompt)` 方法。
    - 封装 `sendMessage` 接口以支持增量 JSON 输出。
- [ ] **`knowledge-extraction-workflow.service.ts` 重写**：
    - 废弃内存合并逻辑 (`mergeKnowledge`)。
    - 实现基于 Session 的逐页发送逻辑。
    - 处理增量 JSON 并在每一页完成后触发数据库 Upsert。

### Phase 4: 数据库驱动的查重合并 (Server-side Merge)
- [ ] **`knowledge-extraction-workflow.repository.ts` 重构**：
    - 实现 `upsertEntity`：
        1. 文本模糊匹配 (FTS)。
        2. 向量语义匹配 (Vector Search)。
        3. 确定 ID 后更新属性。
    - 实现 `upsertRelation`：
        1. 建立或更新边（Edge）的权重与证据。

### Phase 5: 功能验证与迁移
- [ ] 编写数据迁移脚本，将旧的 `store.json` 数据导入 SurrealDB。
- [ ] 重构后端 API 接口，直接从数据库查询图谱结构返回给前端。

## 3. 预期收益
- **Token 节省**：预计 Input Token 消耗降低 50% 以上（不再重复发送累计记忆）。
- **查询效率**：复杂的实体关系查询从 $O(N)$ 降低到数据库级别的图遍历性能。
- **扩展性**：支持跨书籍检索、向量语义搜索等高级 AI 功能。
