# 顶层视角：一条请求从 UI 到服务端的旅程

1. **React 代码 / 业务层** 调用：
   你写的前端业务（比如“点某个句子 → 请求分析”）只需要调用 `messageService.analyzeSentence(...)`。
2. **messageService.ts（语义层 API）**：
   把“业务意图”翻译成**标准消息**（Envelope），补齐默认参数（语言、优先级、缓存策略、prompt 版本、模型档位等），然后把统一的 Envelope 交给下层发送。
3. **networkClient.ts（传输层）**：
   负责**真正发请求**（`fetch`）、超时、取消、重试、（可选）流式分帧回调，把服务器返回的统一响应再交回给 `messageService`。
4. **envelopes.ts（契约层）**：
   这不是“被调用”的模块，而是所有上下层**共同遵守的“通讯契约/类型定义”**。它规定了请求与响应的字段结构、四种分析任务的 payload/data 形状、错误与分帧语义等。

---

# 从上到下逐层讲清楚

## 1) messageService.ts —— “把业务话术翻译成标准请求”

这是你前端会直接使用的入口。你可以把它当作**“语义接口”**：

* 提供**语义化方法**：

  * `fetchSkeleton(payload, ctx?, sendOptions?)`
  * `analyzeParagraph(payload, ctx, sendOptions?)`
  * `analyzeSentence(payload, ctx, sendOptions?)`
  * `analyzeSubsentence(payload, ctx, sendOptions?)`
* 这些方法会：

  * 组装一个**标准 Envelope**（类型=`analyze.sentence.v1` 等），
  * 补齐**默认值**：`api_version`、`locale`、`cache_hint`、`priority`、`prompt_version`、`model_tier`，
  * 规范化并注入**上下文 context**（文档 hash、层级、邻居句/段、全局实体切片等），
  * 然后调用 `networkClient.send(...)` 发出去。
* 优点：

  * 业务层**不需要关心网络细节**、不拼 URL、不写 header、不操心重试；
  * 你换传输方式（HTTP → WebSocket）或改后端路径时，业务代码不动。

> 你可以把 `messageService.ts` 看成“翻译官”：上接**业务语义**，下接**传输层**。

---

## 2) networkClient.ts —— “把标准请求送到服务器并拿回结果”

这是**底层传输层**，对业务层隐藏网络琐事：

* 单一方法：
  `send<TRes, TReq, TFrame>(envelope, { timeoutMs, signal, onFrame, cacheHint, priority })`
* 负责的事情：

  * **HTTP 细节**：POST 到统一 `/msg`，自动附 `Authorization`、`x-request-id`、`Idempotency-Key`；
  * **时序控制**：超时（AbortController）、**取消**（你手动 cancel 或新请求抢占旧请求）、**重试**（408/429/5xx）；
  * **流式帧**（可选）：如果服务端走 NDJSON / SSE，逐帧调用 `onFrame(frame)`；
  * **类型安全**：严格以 `envelopes.ts` 的类型为准，**没有 any**。
* 你得到的返回值就是**统一响应 Envelope**（包含 `status: 'ok' | 'partial' | 'error'`、`served_from`、`usage` 等）。

> 可以把 `networkClient.ts` 看成“快递员”：负责**可靠送达**，并在路上处理堵车（重试）、超时、改道（取消/重发）。

---

## 3) envelopes.ts —— “约法三章的合同（类型与协议）”

这是**通信契约**：前后端、服务端内部模块、调试工具都要遵守：

* **统一信封（Envelope）**：

  * 请求：`type`、`request_id`、`cache_hint`、`priority`、`context`、`payload`…
  * 响应：`status`、`data`、`frames`、`error`、`usage`、`served_from`…
* **四类消息的 payload/data 类型**：

  * `analyze.skeleton/paragraph/sentence/subsentence` 的输入输出结构都在这里定义；
  * 结果里强制包含 **anchors（span + anchor_hash）**，让前端能够把分析**精确投影**回 DOM。
* **错误语义**与**分帧结构**：

  * `E.AUTH / E.RATE / E.TIMEOUT / E.SERVER / E.BAD_REQUEST / E.CONTEXT_MISMATCH / E.MODEL_OVERLOADED / E.CANCELLED`
  * `frames[{ seq, chunk_type, data }]` 用于“先骨架后细节”的流式体验。
* 还包含一些**辅助类型守卫**（如果你需要在上层判断 `isError` / `isPartial`）。

> 把 `envelopes.ts` 看成“合同范本”：确保**每个参与者都说同一种话**，不出错、不歧义。

---

# 它们如何协作？（一眼明白的顺序图）

```
UI/React
  │   点击“分析句子”
  ▼
messageService.analyzeSentence(payload, ctx)
  │  （补默认、组装 Envelope）
  ▼
networkClient.send(envelope, { onFrame? })
  │  （发HTTP，超时/取消/重试/流式）
  ▼
Server /msg （你正在做MVP）
  │  （匹配 type → handler，LLM，缓存）
  ▼
ResponseEnvelope（ok/partial/error + data/usage）
  │
  ▼
messageService 直接返回给 UI
```

---

# 为什么“三层分工”能把复杂度控住？

* **解耦**：业务层只懂“语义”，网络层只懂“传输”，契约层只懂“规则”。互不污染，换一层实现另外两层不用改。
* **可演进**：将来你要加 SSE/WS、队列、缓存命中、幂等去重……**不改语义接口**，只改 `networkClient` / 服务端。
* **可观测**：Envelope 里自带 `request_id`、`usage`，让日志和成本对齐一条线。

---

# 最后一眼的“各自一句话”

* **envelopes.ts**：统一的**通讯协议与类型**（双方的合同）。
* **networkClient.ts**：**可靠送达**的“快递员”（HTTP/重试/取消/流式）。
* **messageService.ts**：**语义 API** 的“翻译官”（把业务意图翻译成标准消息）。

这样看，前后端交互并不复杂：前端只“说人话”（调用 messageService 的语义方法），底层帮你把这些话变成**稳定的、可观测的协议**去和服务器沟通就行了。
