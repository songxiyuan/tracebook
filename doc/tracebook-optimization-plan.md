# Tracebook 优化方案（审计汇总）

> 日期：2026-09-24 ｜ 范围：`@songxiyuan/dsh-tracebook`（仓库 `main` @ `40b8b24`）
> 方法：一次真实使用（用测试账号 sxyID1 记录 TeraBox AI PPT 调查，case `terabox-ai-ppt-sxyid1-7aa61e68`）+ 两轮只读代码审计（Viewer 侧 / Host-存储-测试侧），关键结论均在运行实例上复现。
> 结论摘要：**协议层（8 类 typed block + 证据溯源 + revision）设计是对的，问题集中在四条边** —— 写路径的跨进程与原子性、Artifact 的摄取/定位/安全、Agent 工具面的可读可改、以及 Viewer 的一批确定性小 bug；再加上「交互图」在真实规模下不可读的布局缺陷。

---

## 0. 必做清单（TL;DR）

| # | 一句话 | 类型 | 位置 |
| --- | --- | --- | --- |
| 1 | 流程图首屏 zoom 被 `fit-view-on-init` 压到 0.31（不可读），显式 fitView 的 0.6 护栏被绕过 | bug | `web/src/components/blocks/FlowBlock.vue:120,158` |
| 2 | 跨进程互不可见、静默覆盖（同一 `$DSH_HOME` 多 profile） | bug | `src/host/storage.ts:52` |
| 3 | `put()` 多记录非原子；artifact 先落盘、case 后写 → 撕裂态 + 孤儿文件 | bug | `src/host/storage.ts:103-133`、`src/core/service.ts:300-332` |
| 4 | Artifact 取不到/越界一律 500；**内置示例案例 5 个 artifact 全坏** | bug | `src/host/http.ts:36,40`、`src/host/artifact-store.ts:8-13` |
| 5 | Artifact 以 `inline` + 原始 content-type 提供且无 CSP → 同源 SVG/HTML 可在新标签执行脚本 | security | `src/host/http.ts:94-96` |
| 6 | 绝对 `path` 进模型并出现在 API 响应 → 泄露主机路径、数据与机器绑定 | bug | `src/core/model.ts:267`、`src/host/http.ts:89` |
| 7 | `resolveArtifact` 全局线性扫描 + artifact id 仅 case 内唯一 → 串文件 + O(cases×size) | bug | `src/core/service.ts:376-378`、`src/host/http.ts:92-94` |
| 8 | Agent 工具面：无结构 schema、全量替换、无删除、无单块全文、无大小上限 | enhancement | `src/host/tools.ts:48-57`、`src/core/service.ts:284-303` |

---

## 1. 先对齐概念：Artifact 是什么

### 1.1 一句话定义

**Artifact = Case 里存放的「原始证据文件」**：一段不可解释的字节（截图、HAR、trace、日志、代码片段、下载产物…）加上一份结构化元数据。它回答的是「证据原件在哪、是什么类型、多大、什么时候进来的」，**不承担叙事**。

与之相对，**Block 是叙事与结论**（markdown / facts / flow / table / timeline / evidence / gallery / api），有严格 schema、可被搜索与 diff；Block 想引用证据时只用 id 指过去（`artifactRef` / `artifactRefs`）。

| | Block | Artifact |
| --- | --- | --- |
| 语义 | 结论、结构化的调查结果 | 原始材料（不可解释字节 + 元数据） |
| 校验 | 每种类型独立 schema（`src/core/model.ts`） | 只有元数据 schema，内容不解析 |
| 版本 | upsert by stable id，进 revision 快照，可 diff | 记录进 case，字节落在 artifactDirectory，**不进 revision 快照**（`revisionSnapshotOf` 只取 blocks） |
| 展示 | 8 种渲染器 | 按 kind/mime 内嵌预览或下载 |
| 写入入口 | `tracebook_update.upsertBlocks` | `tracebook_update.artifacts` |

### 1.2 数据模型

```ts
// src/core/model.ts:261-272
artifactSchema = {
  id, caseId, kind, mimeType?, name?, path?, size?, summary?, metadata?, createdAt
}
// src/core/model.ts:352-363 —— 写入用的输入 schema
artifactInputSchema = { id?, kind, mimeType?, name?, summary?, metadata?, contentBase64? | contentText? }
```

- `kind` 是自由字符串（`screenshot` / `http` / `trace` / `code` / `har` / `log` …），Viewer 用它选渲染器与图标（`web/src/artifact-kind.ts`）。
- **`path` 是服务端绝对路径**，由 store 在落盘后回填；它出现在 `GET /tracebook/api/cases/:id` 的响应里（见 P0-6）。
- 输入 schema **没有 `path`**：字节只能内联传（`contentText` / `contentBase64`，互斥，`model.ts:361`）。

### 1.3 两种实现（`ArtifactStore` 接口）

| 实现 | 用途 | 行为 |
| --- | --- | --- |
| `FileArtifactStore`（`src/host/artifact-store.ts`） | 默认 | 字节写入 `<artifactDirectory>/<caseId>/<artifactId><ext>`，回填绝对 `path`；`resolve()` 先用 `assertInside` 校验再返回 |
| `MetadataOnlyArtifactStore`（`src/core/artifact-store.ts`） | 受限部署 / 测试 | 只记元数据与 size，`resolve()` 恒返回 `undefined`，Viewer 退化为链接 |

`artifactDirectory` 默认 `.tracebook/artifacts`（**相对进程 cwd**，`src/index.ts:33`）。本机实况：

- `web`（3080）→ `/Users/nomis/.dsh/storages/tracebook-artifacts`（profile patch 里写死绝对路径）
- `test-account`（3081）→ `/Users/nomis/Documents/my-dsh/.tracebook/artifacts`（默认值）
- 结果：两个 profile 各自一套 artifact，示例案例记录的 path 指向旧的根 → 全部取不到（P0-4）。

### 1.4 读取链路

```
Viewer: GET /tracebook/api/artifacts/:artifactId
  → TracebookService.resolveArtifact()            遍历所有 case、每个 case 全量 get()   ← P0-7
  → ArtifactStore.resolve()                        assertInside(root, artifact.path)     ← P0-4
  → handleApi → streamFile()                      content-type: lookup(path)             ← P0-5/14
```

### 1.5 这次实际踩到的三个坑（都来自 1.2 的两个设计选择）

1. **只能内联传字节**：我为了把一张 300KB 的截图塞进 case，基数是 `base64 ≈ 1.33×`；实际经验是 —— **>5KB 的 base64 在工具调用里被截断 3 次**，落库的图片是坏的（可 `file` 通过、肉眼可见下半截灰）。→ 建议：工具侧允许工作区内 `path` 摄取（白名单校验）或新增 stage 工具，并对 base64 做长度/校验和断言。
2. **`path` 与 `root` 不一致即永久失效**：记录的 path 是绝对路径，root 换一次（改配置、换 cwd、换机器）就全部 500。→ 建议：`path` 移出模型，由 `resolve()` 用 `caseId + artifactId` 推导；换根时做一次对账并给出可读错误。
3. **没有删除/回收**：写错一个 artifact 只能覆盖同 id，旧文件永久留在盘上；`put()` 只清理 artifact *记录*（`src/host/storage.ts:119-126`），不 unlink 文件。

### 1.6 概念层面的建议

- 把「**证据（Artifact）**」与「**叙事（Block）**」的边界写进 README 与工具描述：Agent 应当「结论进 Block，原件进 Artifact，Block 用 ref 指过去」——目前文档只在 `doc/` 里隐含表达。
- 给 `kind` 与 `mimeType` 定一份推荐取值表（现在 kind 完全自由，导致渲染器只能靠前缀猜）。
- `metadata`（`z.record(z.string(), z.unknown())`）是唯一的扩展位，但没有约定；建议至少约定 `capturedAt` / `source` / `hash`，这样证据可校验、可对账。

---

## 2. 「交互图」为什么乱，怎么优化

### 2.1 实测诊断（在 3081 的真实 Viewer 上量的）

对 case `terabox-ai-ppt-sxyid1-7aa61e68` 的 `gen-flow` block：

| 指标 | 实测值 |
| --- | --- |
| 节点 / 边 / 带标签边 | 16 / 15 / 10 |
| 节点自然尺寸 | 150 × 83 px |
| 画布尺寸 | 1086 × 296 px |
| **首屏 zoom** | **0.312** → 节点实渲染 **47 × 26 px**（文字不可读） |
| 点击任一布局按钮后 zoom | **0.6**（护栏生效，文字可读，需平移） |

截图对照：`.runtime/ppt-sxyid1/shots/flow-before-031.png`（首屏，糊）vs `flow-after-060.png`（切一次布局后，可读）。

### 2.2 根因（按可修性排序）

1. **首屏 fit 绕过了作者写好的缩放护栏** [bug，一行]：`FlowBlock.vue:120` 明确写了 `fitView({ padding: 0.12, minZoom: 0.6 })`，但模板上的 `fit-view-on-init`（`:158`，配合 `:min-zoom="0.2"`）在初始化时又做了一次不受 0.6 约束的 fit。实测「首屏 0.312 / 切换布局后 0.6」正是这两次 fit 的差别。→ 修：去掉 `fit-view-on-init`，或把它挪到 ELK 布局完成之后再调用，或把 `:min-zoom` 提到 0.6。
2. **一张图塞了四种语义** [内容]：页面跳转 + HTTP 调用 + SSE 通道 + 产出物全在一条链上，ELK 的 layered 布局只能把它们排成一条 5 屏长的直线，`fitView` 必然缩到不可读。
3. **同一件事画了三遍** [内容]：`overview` 里的编号列表、`gen-flow` 流程图、`page-gallery` 里我手写的 SVG 链路图 —— 读者要在三张图之间来回对照，这是"乱"的另一半。
4. **label 过长、承担了本应属于 details 的信息** [内容]：`完成卡片（11.3MB / 去查看 / 下载 / 保存）`、`编辑器 /ai/ppt/edit?...&docId=…` 这类 label 在 47px 宽的节点里必然溢出；Vue Flow 的节点没有截断策略。
5. **缺少面向"时序"的表达手段** [插件]：请求→响应→异步推送本质上是一条**时序**，flow 是拓扑图；作者只能硬塞进 flow，图必然既不像拓扑也不像时序。

### 2.3 立刻可做的内容侧规范（不改代码）

写给作者（含未来的 Agent）的 `flow` block 约定：

1. **一张图只讲一件事，≤ 8 节点 / ≤ 10 边**；超过就拆成多个 flow block（每个都有独立标题，Contents 里天然分段）。
2. **direction 按形状选**：串联时序用 `LR`；分支/层级用 `TB`。当前默认 `TB` 是长链被压扁的直接原因之一。
3. **label ≤ 12 个汉字 / 24 字符**，只写"是什么"；接口全名、耗时、URL 放进 `details`（点击节点在 Inspector 里看）。
4. **边标签只写事件名**（`点「继续」`、`is_end`），不写句子。
5. **kind 用来表达类型**（page / api / stream / artifact，Viewer 已按 kind 着色），不要用 label 重复类型。
6. **时序不要用 flow**：用 `timeline`（已有）或新的 `sequence` block（见 2.5）。
7. **同一条链只保留一种视图**：要么 flow，要么截图/SVG，不要并存。

**本案例的具体重排方案**（可直接执行）：

| 拆分后 | 节点 | direction |
| --- | --- | --- |
| `flow-pages` 页面流转 | 入口页 → 大纲页 → 模板弹窗 → 编辑器 → 完成卡片（5 节点） | TB |
| `flow-generate` 生成时序 | chat/create → ppt/savesettings → credits/precheck → ppt/genoutline → SSE 大纲 → ppt/notice → ppt/genppt → SSE slides（8 节点） | LR |
| `flow-export` 导出 | 编辑器 → pptx/get → pptx/save → pptx/downloadV2 → .pptx（5 节点） | LR |
| 删除 | `page-gallery` 里的手写 SVG（与上面重复），只留真实截图 | — |

### 2.4 插件侧改造（FlowBlock）

| # | 改造 | 说明 | 位置 |
| --- | --- | --- | --- |
| 1 | **修掉首屏 fit 护栏**（P0） | 去掉 `fit-view-on-init` 或延后 fit；`min-zoom` 统一到 0.6 | `FlowBlock.vue:120,158` |
| 2 | **缩放过小时的降级策略** | fit 后若 `zoom < 0.6`，渲染「概览模式」：只显示主干 + 「展开全部」按钮，或按 kind 折叠 | 新增 |
| 3 | **自动方向** | 按节点数/链路长宽比在 LR / TB 间自动选（现在是固定 TB + 手切） | `FlowBlock.vue:65-79` |
| 4 | **长链折行** | ELK layered 开 `wrapping`（或按 `kind` 分层，同 kind 对齐成泳道），避免一条 5 屏直线 | `FlowBlock.vue:93` |
| 5 | **label 策略** | 单行截断 + `title`/tooltip 显示全文；选中节点才展开 | 新增 |
| 6 | **分组泳道** | 用 Vue Flow 的 parentNode 把「页面 / 接口 / SSE / 产出」分成 4 个 group，带组标题 | 新增 |
| 7 | **图内交互** | hover 高亮邻接、双击折叠子树、按 kind 过滤、图内搜索高亮、minimap 开关 | 新增 |
| 8 | **缩放三档** | 「适宽 / 适图 / 100%」+ 当前百分比显示（现在只有 +/- 和 fit） | 新增 |
| 9 | **修 layout 失败的静默空白** | `onMounted(layout)` 与 `elk.layout` 没有 catch，边引用不存在节点时白板 | `FlowBlock.vue:92-121,139` |
| 10 | **布局偏好按 case 存** | 现在 key 是 `tracebook:flow-direction:<blockId>`，不同 case 复用同名 block id 会互相污染 | `FlowBlock.vue:65` |
| 11 | **兜底渲染** | 未知 block 类型现在是空白（`BlockRenderer.vue:38` 无 fallback） | `BlockRenderer.vue:16-25,38` |

### 2.5 建议新增：`sequence` block（时序图）

「交互」的主体是**带时间的消息往返**，flow 表达不了。建议在 `model.ts` 增加第 9 种 block：

```ts
sequenceBlockSchema = blockBase.extend({
  type: 'sequence',
  participants: [{ id, label, kind? }],           // 页面 / 网关 / 服务 / SSE
  messages: [{
    from, to, label,                                // 事件名
    kind: 'sync' | 'async' | 'stream',              // 同步 / 异步 / 流式
    status?, durationMs?, timingSource?,             // 复用 TIMING_SOURCES 口径
    artifactRefs?, note?,
  }],
})
```

收益：一次性解决「接口时序」的表达问题；`durationMs + timingSource` 直接复用已有证据溯源规范；Viewer 用一个纵向泳道图渲染（约 200 行 Vue），比让作者硬塞 flow 便宜得多。这也是 `docs/research/` 里已有 API 详情渲染研究能直接接上的地方。

---

## 3. 全量优化清单

标注：**[bug]** 确定性缺陷 ｜ **[fragility]** 脆弱点 ｜ **[security]** 安全 ｜ **[enhancement]** 能力/体验改进。
证据路径相对仓库根。

### P0 —— 正确性 / 安全（建议下一版修完）

| # | 问题 | 证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| P0-1 | 跨进程互不可见 + 静默覆盖 | `src/host/storage.ts:52` 用 `facility.open()`；DSH `dsh-storage-domain` 语义为「open 时 loadAll 一次 + 权威内存态、同步读」 | 同一 `$DSH_HOME` 的两个 profile：A 建的 case 在 B 里不存在（`tracebook_open` 报 `Case not found`，实测），且并发写互相覆盖；`serialize` 队列（`src/core/service.ts:216-224`）只作用于单进程 | 用 `domain.table(k).update(key, fn)` 做原子 RMW；暴露 reload/reopen；NOT_FOUND 文案说明"可能由另一进程写入" |
| P0-2 | `put()` 多记录非原子 | `src/host/storage.ts:103-133`：cases → blocks(逐条) → artifacts(逐条) → revisions | 中途失败/close 留下 case 指向已删 block、或 revision 快照与 blocks 不一致的撕裂态 | case 记录最后提交；或一个 case 一条聚合记录（域支持单键原子） |
| P0-3 | artifact 先落盘、case 后写 | `src/core/service.ts:300-303` 先 `artifactStore.save`，`:332` 才 `repository.put` | 后续失败 → 永久孤儿文件（无 GC、无 delete） | 反序 + 失败补偿 + 对账清理 |
| P0-4 | 取不到/越界一律 500（内置示例案例 5 个 artifact 全坏，已复现） | `src/host/artifact-store.ts:8-13` 抛裸 `Error`；`src/host/http.ts:36` 只把 `TracebookError` 映射为 404；`:40` `stat` ENOENT 同路 | `curl /tracebook/api/artifacts/demo-screenshot` → `{"code":"INTERNAL_ERROR"}`；用户无法区分"文件没了"与"插件崩了" | store 抛 `ARTIFACT_NOT_FOUND`；Zod→400、FS→404；示例 seed 用当前 store 重新落盘 |
| P0-5 | Artifact `inline` + 原始 content-type + 无 CSP | `src/host/http.ts:94-96`、`streamFile`（实测响应头只有 `content-disposition: inline`、`content-type: image/svg+xml`、`nosniff`） | artifact 内容由 Agent 写入、可能来自外部抓取；在新标签页打开 SVG/HTML 即在 DSH 同源执行脚本（`<img>` 引用不执行，点击打开会） | 活动类型强制 `attachment`；或 `Content-Security-Policy: sandbox`；或独立源 |
| P0-6 | 绝对路径进模型并随 case 返回 | `src/core/model.ts:267`；`src/host/artifact-store.ts:48`；`src/host/http.ts:89` | 泄露主机路径；数据与机器/根目录绑定（P0-4 的成因） | `path` 移出 model 与 API，`resolve()` 内部推导 |
| P0-7 | `resolveArtifact` 全局扫描 + 全局 id 空间 | `src/core/service.ts:376-378`；`src/host/storage.ts:85-90`；`src/host/http.ts:92-94` | 取一个 artifact = O(cases × case size)；不同 case 的同名 artifact 会串文件 | `/cases/:id/artifacts/:artifactId` + `artifactIndex` 表 |
| P0-8 | 流程图首屏不可读 | `FlowBlock.vue:120` vs `:158`；实测 zoom 0.312 / 切换后 0.6 | 16 节点的图在首屏等于一张糊图 | 去掉 `fit-view-on-init` 或延后 fit；见 §2.4 |

### P1 —— 数据完整性、契约与 Agent 体验

| # | 问题 | 证据 | 影响 | 修法 |
| --- | --- | --- | --- | --- |
| P1-1 | id 唯一性无人校验 | `src/core/model.ts:54-64` 只校验 flow 边引用；`:245-248`、`:281` 无唯一性 refine | 同一次 update 里两个同 id block/endpoint 静默丢一个；`blockOrder` 出现重复项 | 对 block/artifact/endpoint/node/edge/column id 加 `superRefine`，并校验 order 数组 |
| P1-2 | `expectedRevision` 非原子 + 空更新也涨 revision | `src/core/service.ts:279` compare-then-set；`:329` 无条件 +1；`src/host/storage.ts:128-132` 每版存整份 blocks | 跨进程 CAS 失效；磁盘 O(更新次数 × blocks)，历史一半是空转 | 存储层 CAS；内容未变不涨；revision 保留策略/压缩 |
| P1-3 | `open()` 忽略 metadata、`linkSession` 未入队 | `src/core/service.ts:228-234`、`:257-266` | 带 `caseId` 重开时 `title/type/environment` 静默无效；并发 open 丢 `sourceSessions` | 走 `serialize`；显式 reject 或应用 metadata |
| P1-4 | 可选字段无法清空 | `src/core/service.ts:321-325` 全是 `??` | 写错的 summary/environment 擦不掉（`null` 被 schema 拒） | 接受 `null` 表示清除，或引入 patch/unset 约定 |
| P1-5 | 未知字段静默丢弃 | `src/core/service.ts:290` `blockSchema.parse`（Zod 默认 strip） | Agent 把 `p95` 写成 `p95Ms` 会"成功但没写进去" | `.strict()` 或返回被丢弃字段列表 |
| P1-6 | 无任何大小/数量上限 | `src/core/model.ts:17`、`:359-360`；`src/core/service.ts:301-303` | 一次 update 可写 MB 级 base64（内存双份），可撑爆模型/工具负载；实测 >5KB base64 会被截断且无校验 | 字节上限 + 数组长度上限 + base64 校验 + 413/400 |
| P1-7 | MIME 与扩展名优先级颠倒 | `src/host/artifact-store.ts:32-35` 先 `extname(name)`；`src/host/http.ts:43` 按路径回推 | `name:'trace.txt'` + `mimeType:'application/json'` 被当 `text/plain`，inline HAR/图片预览失效 | 以校验过的 `mimeType` 为准 |
| P1-8 | 一条坏记录毒化整个 case 读取，无迁移 | `src/host/storage.ts:100` 无 `safeParse`；`:32` `version: 1` 无升级路径 | 老/手改 JSON 让 `get`/`revision`/`resolveArtifact` 全 500 | `safeParse` + 修复日志 + 版本迁移 |
| P1-9 | 工具面：黑盒 schema、全量替换、无删除、无单块全文 | `src/host/tools.ts:48-57` `items:{type:'json'}`；`src/core/service.ts:284-303`；`:84-127` 每块截断 900 字符、api 只列前 10 条；`:344-360` 最多 20 块 | 模型凭文档猜 schema，一处不合法整次调用失败；改一个字段要重发整块；写错无法删除；大 case 接手者读不全 | 暴露各 block 判别式 JSON Schema；加 `list/search/delete/archive` 与 `patchBlocks`；加「读单块全文」 |
| P1-10 | Artifact 只能内联摄取 | `src/core/model.ts:352-363` 无 `path` | 大文件/已有文件无法引用；工具参数里塞 base64 又贵又易损（实测截断 3 次） | 允许工作区内 `path`（白名单）或新增 stage/upload 工具 |
| P1-11 | 引用完整性不校验 | 只有 flow 边校验；`artifactRefs` / `relatedBlockIds` 无校验 | 悬空引用在 Viewer 里是坏图/500（示例案例就是），且写入时无警告 | 写入返回 `warnings`，Viewer 兜底为文字链接 |
| P1-12 | artifact 无回收、无 delete 路径 | `src/host/storage.ts:119-126` 只清记录；`src/host/artifact-store.ts` 无 unlink | 改名/覆盖留旧文件；归档调查永不放盘 | 覆盖/裁剪时 unlink；加 delete/保留策略；文件对账 |
| P1-13 | `safeSegment` 保留 `.`/`..`，守卫只是词法比较 | `src/host/artifact-store.ts:15-17`（实测 `safeSegment('..') === '..'`）；`:7-13` 无 `realpath` | `id:'..'` 且无后缀时目标解析为 root 自身 → 对目录 `writeFile` 报 EISDIR；有后缀则产生 `...txt` 这类怪名（**未发现真实越界**）；symlink 根可绕开词法校验 | 显式拒绝 `.`/`..` 段；`mkdir` 后 `realpath` 再比较 |

### P2 —— Viewer（多为一行级修复）

| # | 问题 | 证据 | 修法 |
| --- | --- | --- | --- |
| P2-1 | 品牌链接把会话读者弹回当前 case | `web/src/App.vue:4` `to="/"` vs `CaseList.vue:66-72` 自动跳 active | 改 `/?all=1` |
| P2-2 | 搜索无结果显示「No cases yet」 | `CaseList.vue:166` 裸 `v-else` | 按 `cases.length` 分支 + 清除入口 |
| P2-3 | 刷新失败被更新横幅盖住 | `CaseDetail.vue:126-140,276-285` | catch 里清 `pendingRevision` |
| P2-4 | 切换 case 可能渲染错文档（乱序竞态） | `CaseDetail.vue:96-108,219-223` | 捕获 id、丢弃过期响应 |
| P2-5 | Revision 侧栏未 catch + 竞态 | `RevisionHistory.vue:80-100` | try/catch + 请求令牌 |
| P2-6 | diff 只比 blocks，忽略 artifacts/title/status/summary，且只列字段名 | `RevisionHistory.vue:27-47` | 纳入 artifacts 与元数据；显示 before→after |
| P2-7 | 刷新会丢弃用户选定的对比版本 | `RevisionHistory.vue:105` | 保留 base/target 选择 |
| P2-8 | timing 单位被忽略 → 差 1000 倍 | `ApiBlock.vue:135-138` 硬编码 ms→s，而 `:371` 打印 `unit` | 按 `unit` 格式化（或解析期归一为 ms） |
| P2-9 | 错误率除零 → `err NaN%` | `ApiBlock.vue:217-219` | `sampleSize < 1` 返回 `undefined` |
| P2-10 | HAR 不随 block 更新失效 | `ApiBlock.vue:80-81` 早退、`harStates` 不重置 | 以 `artifactRef`/revision 为键 |
| P2-11 | 预览静默截断 20k 字符 | `ArtifactPanel.vue:43` `slice(0,20000)` | 标注 + 「查看原文」 |
| P2-12 | 单个全局 loading/failure 串台 | `ArtifactPanel.vue:11-12,32-47` | 按 artifact.id 分键 |
| P2-13 | 预览类型识别过窄（无 xml/yaml/csv/diff/har/PDF），图片无 `@error` 兜底、无 lightbox | `ArtifactPanel.vue:25-30` | 扩类型表 + 兜底 + 缩放 |
| P2-14 | 未知 block 类型静默空白 | `BlockRenderer.vue:16-25,38` | 兜底卡片并打印原始 payload |
| P2-15 | flow 方向偏好键不含 caseId | `FlowBlock.vue:65` | 键里加 caseId |
| P2-16 | flow 布局失败 = 白板且未捕获 | `FlowBlock.vue:92-121,139` | try/catch + 错误态 + 边校验 |
| P2-17 | 请求无 timeout/abort、无客户端缓存、列表页无重试 | `web/src/api.ts:3-10`；`CaseList.vue:132` | AbortController + 统一错误态 + revision 驱动的缓存 |
| P2-18 | 会话参数只在 `onMounted` 读一次 | `CaseList.vue:56` | watch `route.query.session` |
| P2-19 | 大纲编号随搜索结果变化、无 scroll-spy | `CaseDetail.vue:268-269` | 用文档序号 + 当前节高亮 |
| P2-20 | Ask 弹窗无 dialog 语义/焦点管理/Esc | `CaseDetail.vue:339-365` | `role="dialog"` + focus trap + Esc |
| P2-21 | 搜索框无可访问名、Flow 仅鼠标可用、无深色主题 | `CaseList.vue:127`、`FlowBlock.vue:158-164`、`TracebookAction.tsx:45` | a11y 与主题适配 |
| P2-22 | `onAskResult` 只校验 `event.source` 不校验 origin | `web/src/session.ts:90-95` | 加 `event.origin` 校验 |
| P2-23 | `TracebookTab` 无 Viewer 失败态（白 iframe） | `src/client/TracebookTab.tsx:18-23` | 错误态 + 重试 |
| P2-24 | 头部按钮在 `openTab` no-op 时静默失败 | `src/client/TracebookAction.tsx:82-90` | 兜底打开新标签 |

**Viewer 能力缺口**（作者/读者会预期，目前完全没有）：跨案例全文搜索；按 status/type/environment/时间过滤排序；导出（Markdown/JSON/打印）；case/block/revision/endpoint 级分享深链与复制 cURL；可渲染的双栏 revision 对比与 revert；键盘快捷键与帮助；深色主题；图片 lightbox；artifact 下载/复制；页面标题与真正的 404 页。

### P3 —— 工程、发布与实时性

| # | 问题 | 证据 | 修法 |
| --- | --- | --- | --- |
| P3-1 | 真实持久化层零测试（`host/storage.ts`、`index.ts`、`host/tools.ts` 都没有测试；`artifact-store.test.ts` 只测 happy path；`built-viewer.test.ts:25` 在干净 checkout 上 `skipIf` 静默跳过） | `tests/` 只用 `MemoryRepository` + `MetadataOnlyArtifactStore` | 加临时 `$DSH_HOME` 集成测试（round-trip/顺序/历史/并发写）+ artifact 越界/文件缺失 + verify 里 viewer 测试必须失败而非跳过 |
| P3-2 | `prepare` 让无依赖树无法打包；peer 版本漂移 | `package.json:49`（实测无 `node_modules` 时 `npm pack` 报 `vite: command not found`）；devDeps `0.1.5-rc.3` vs peerDeps `^0.1.5-rc.2` | build 挪到 `prepack`/`prepublishOnly`；peer 钉实测版本；加 pack 内容断言（**注：`files:["dist",…]` 确实带上了 `dist/web`，不是问题**） |
| P3-3 | `inject` 与 `httpServer` 回退自相矛盾 | `src/index.ts:19` 强制注入 `webServer`，而 `src/host/http.ts:139-143` 的回退分支永不可达 | 两个服务都声明（或标 optional），让回退有意义 |
| P3-4 | 双重序列化与静默 catch | `src/host/tools.ts:7-9`；`src/core/service.ts:220-222` | 已 JSON-safe 直接返回；清理失败至少记日志 |
| P3-5 | 实时性只有 12s 轮询，而 Host 侧已有 `domain/changed` 事件 | `CaseDetail.vue:236`；`dsh-storage-domain` 的 `domain/changed` | 加 SSE/长轮询端点做同进程推送（跨进程再配文件监听） |

---

## 4. 落地顺序与验收

**批次 A（小步快跑，1 天内可发版）**
P0-4 的错误映射、P0-8 首屏 fit、P2-1…P2-16 里低风险项、P1-7。
验收：`curl /tracebook/api/artifacts/<坏 id>` 返回 404 + `ARTIFACT_NOT_FOUND`；17：在 case `terabox-ai-ppt-sxyid1-7aa61e68` 上首屏 zoom ≥ 0.6；`npm test` 全绿且新增针对 P2-8/P2-9/P2-11 的单测。

**批次 B（写路径加固）**
P0-1/P0-2/P0-3/P1-2（存储层原子 RMW + CAS + 提交顺序）、P0-7（case 维度 artifact 路由）、P3-1（集成测试）。
验收：两个 profile 并发写同一 case 不再丢更新；kill -9 模拟中断后 case 不出现撕裂态（`blockOrder` 与 blocks 一致）；artifact 路由带 caseId 后同名 id 不串。

**批次 C（工具面）**
P1-9/P1-10/P1-6（结构化 schema、patch/delete/archive、单块全文、path 摄取、限额）、P1-11（引用校验 warnings）。
验收：模型无需文档即可从工具 schema 生成合法 block；一次 update 能删除 block/artifact；`tracebook_context` 可按 blockId 读全文；超限请求返回 413 且不落盘。

**批次 D（表达力与实时）**
§2.4 的泳道/分组/交互、§2.5 的 `sequence` block、P3-5（SSE）、P1-8/P1-12（迁移与回收）。
验收：把本案例的 16 节点图重排为 3 个 ≤8 节点的图后，首屏即可读；时序用 `sequence` 渲染出带耗时的消息图；同进程内 case 更新 1s 内出现在已打开的 Viewer。

---

## 5. 附录

### 5.1 复现命令

```bash
# 1) 示例案例 artifact 500（P0-4）
curl -s http://127.0.0.1:3081/tracebook/api/artifacts/demo-screenshot
# → {"error":{"code":"INTERNAL_ERROR","message":"Unexpected Tracebook error"}}

# 2) 流程图首屏 zoom（P0-8）：0.312；点任一 layout 按钮后 0.6
#    见 .runtime/ppt-sxyid1/measure-zoom.mjs

# 3) 跨进程不可见（P0-1）
curl -s http://127.0.0.1:3080/tracebook/api/cases | jq '.cases[].id'
curl -s http://127.0.0.1:3081/tracebook/api/cases | jq '.cases[].id'
# 3080 能看到另一进程建的 case，3081 看不到，反之亦然

# 4) pack / 版本（P3-2）
npm pack --dry-run      # 无 node_modules 时报 vite: command not found
```

### 5.2 审计覆盖

- 代码：`src/core/*`、`src/host/*`、`src/index.ts`、`src/client/*`、`web/src/**`、`tests/*`、`package.json`、`tsup.config.ts`、`web/vite.config.ts`、`scripts/build-client.mjs`、`doc/*`、`README.md`。
- 运行实例：3080（web，link 源码）、3081（test-account，npm 0.1.0）双实例对照；真实 case `terabox-ai-ppt-sxyid1-7aa61e68`。
- 未验证（需进一步确认）：`ctx.sidebarRight.openTab` 的失败语义；Vue Flow 默认边是否渲染 `label`；`@cloudflare/waterfall` 自定义元素注册失败时的兜底；revision 列表顺序假设（`RevisionHistory.vue:68` 取 `[0]` 为最新）。

### 5.3 与本机部署相关的两点

1. `web` 与 `test-account` 的 `artifactDirectory` 不一致（前者绝对路径、后者默认相对 cwd），是 P0-4 与「两个 profile 各有一份数据」的共同根因；建议默认锚定 `DSH_HOME` 并在启动时对不一致告警。
2. 本机 `~/.dsh/storages/tracebook-artifacts` 下还留着指向旧根的示例 artifact 文件，修 P0-4 时一并做一次性对账即可。
