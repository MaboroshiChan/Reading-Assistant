给你一个“只测该测的”的清单，按**必须测 / 建议测 / 可以先不测**三挡来分（前端 + 服务端一起看）。不写代码版，直接告诉你哪些文件要覆盖，为什么。

# 必须测（优先做，性价比最高）

**前端（reading-app）**

* `envelopes.ts`（类型契约）

  * 测什么：用少量“合同样本 JSON”校验结构（可以用 zod/ajv 或 TypeScript 类型测试）。
  * 价值：前后端契约不跑偏；一旦改字段立刻报警。
* `networkClient.ts`（传输层）

  * 测什么：

    1. 成功路径（header、body、返回解析）
    2. 超时/取消（AbortSignal 生效）
    3. 重试（429/5xx 后成功）
    4. 流式帧 onFrame 回调（NDJSON 三行）
  * 价值：最容易出坑的地方（时序/异常/流式）。
* `messageService.ts`（语义层）

  * 测什么：默认值是否补齐（priority/locale/cache_hint/prompt_version）、上下文拼装是否传下去、帧类型推断是否正确。
  * 价值：保证业务只写语义调用就能工作。

**服务端（reading-app-server）**

* `utils/cacheKey.ts`（缓存键生成）

  * 测什么：相同输入稳定、不同 prompt_version/model_tier/文本 → 不同键；特殊字符/emoji 也稳定。
* `services/cache.ts`（内存缓存）

  * 测什么：TTL、命中/过期、覆盖。
* `handlers/sentence.ts`（先挑一个代表 handler）

  * 测什么：

    1. 读 envelope → 生成 prompt（可用快照）
    2. 命中缓存直接返回
    3. 调用 **mock** 的 llmService.json 产出 DTO
    4. anchors 填充与返回结构
  * 价值：跑通最关键链路；其他 handler 可复用同样套路。
* `http/router.ts`（/msg 入口）

  * 测什么：类型路由、基础错误（缺 type/payload → 400）、把 handler 结果包成统一 Envelope。

# 建议测（第二梯队，覆盖易变边角）

**前端**

* （如果有）`adapters/*`（分析 DTO → 视图 VM 的映射）

  * 测什么：函数式映射——输入 X 得到期望字段与枚举映射。

**服务端**

* `services/llmService.ts`（在 mock 模式下）

  * 测什么：不连真模型，mock fetch：

    1. 能解析 Responses API 文本/JSON（含 `json fenced`）
    2. 错误时抛出
  * 价值：验证解析器逻辑，未来换 SDK 也有保障。
* `utils/anchors.ts`

  * 测什么：span 合法性、anchor_hash 稳定。

# 可以先不测（或用集成/E2E覆盖即可）

* `index.ts`（启动/监听端口）

  * 说明：在集成测试里用 Supertest/内存 server 调路由即可，不必为“监听端口”写单测。
* `prompts/*`（纯文本模板）

  * 说明：在 handler 的“prompt 快照”里自然被覆盖；单独测意义不大。
* 重复逻辑的其他 handler（`paragraph.ts` / `subsentence.ts` / `skeleton.ts`）

  * 说明：等 `sentence` handler 的测试稳定后，再复制一两份代表性用例即可；不必一开始全铺开。

# 覆盖方式建议（怎么测最省力）

* **单测（unit）**：`cacheKey`、`cache`、`anchors`、`messageService`（用 fake NetworkClient）、`networkClient`（mock fetch）。
* **集成（integration）**：`router + handler + mock llmService`，不监听端口，用 Supertest/内存 server。
* **合同样本（contract）**：`envelopes.ts` 用 3～4 个 JSON 样本做结构校验（ok/partial/error）。
* **E2E（可选，最后再做）**：前端 `MessageService` 直接打本地 `/msg`（server 内置 mock LLM）。

# 先后顺序（落地路线图）

1. 单测：`cacheKey`、`cache`、`networkClient`
2. 单测：`messageService`（fake NetworkClient）
3. 集成：`router + sentence handler`（mock llmService）
4. 合同：`envelopes` 样本校验
5. 需要时再补其他 handler 与 E2E

这样分层覆盖，能用**最少的测试**拿到**最大的风险对消**，而且几乎不需要连大模型。
