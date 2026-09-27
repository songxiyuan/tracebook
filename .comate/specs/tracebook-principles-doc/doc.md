# 需求文档：Tracebook 原理说明文档

## 1. 需求场景与目标

新读者（工程师 / 未来的 Agent）需要一份**从代码出发**、讲清 Tracebook「是什么、怎么运转、数据长什么样」的原理文档。现有 `doc/` 下只有：

- `tracebook-dsh-plugin-design.md`（早期设计）
- `tracebook-optimization-plan.md`（审计与优化清单）
- `tracebook-pending-interactions.md`（待办交互）

缺一份**当前实现的原理总览**。本次交付即补齐这一篇。

### 处理逻辑

- 只做**只读整理**：读代码 → 归纳 → 成文，不改任何业务代码。
- 所有结论以现仓库代码为准（已通过 Explore 全量探查 + 关键文件精读核对）。
- 关系图用 **Mermaid**（md 原生可渲染），保证 IDE / GitHub 直接可看。

## 2. 交付物

**单一文件**：`doc/tracebook-principles.md`（与既有文档同目录，kebab-case 命名）。

不新增其他文件。写完后按项目约束（AGENTS.md §4）自动提交一次 Git commit。

## 3. 文档结构（章节大纲）

| # | 章节 | 内容要点 | 主要依据 |
| --- | --- | --- | --- |
| 1 | 一句话定位与产品边界 | 是 DSH 调查结果组织插件，不是 Agent Runtime / 探索引擎 / 根因分析；职责=规范化·持久化·管理 Artifact·展示·供上下文 | `AGENTS.md`、`README.md`、`src/index.ts` |
| 2 | **框架结构图** | 四层架构（Core / Host / Client / Web）分层图 + 各层职责表 + 依赖方向约束（Core 不依赖 DSH/DB） | `src/index.ts`、`src/core/*`、`src/host/*`、`src/client/*`、`web/*` |
| 3 | 核心概念：Block vs Artifact | 叙事(Block, 严格 schema, 进 revision) vs 证据(Artifact, 原始字节+元数据, 不进 revision) 对照 | `src/core/model.ts` |
| 4 | **数据模型** | Case / Block(9 类) / Artifact / Revision 的字段与实体关系图(ER)；upsert-by-stableId、blockOrder、revision 语义 | `src/core/model.ts`、`src/core/service.ts` |
| 5 | Agent 写入协议（3 个 Tool） | `tracebook_open` / `tracebook_update` / `tracebook_context` 的入参、语义、限额、warnings、单块全文 | `src/host/tools.ts`、`src/core/service.ts` |
| 6 | **交互图（时序）** | 两条主链的 sequence 图：① Agent 调查写入链（Tool→Service→Repository/ArtifactStore）② Viewer 读取与实时刷新链（HTTP + SSE 兜底轮询） | `src/host/http.ts`、`src/host/storage.ts`、`src/host/artifact-store.ts`、`web/src/api.ts` |
| 7 | 持久化与存储抽象 | `CaseRepository` 抽象 + DSH `storage-domain` 实现（per-record 五张表）；写路径三段式原子提交；no-op 不涨 revision | `src/core/repository.ts`、`src/host/storage.ts`、`src/core/service.ts` |
| 8 | Artifact 存取链路 | FileArtifactStore vs MetadataOnly；落盘路径、path 不出模型、caseId 维度路由、CSP sandbox、mimeType 优先、path 摄取白名单 | `src/host/artifact-store.ts`、`src/host/http.ts` |
| 9 | Viewer 渲染体系 | BlockRenderer 分发 → 9 种 block 组件；Flow=Vue Flow 渲染 + ELK.js 布局；Sequence/Flow 的语义护照、可达透镜、缩放/演示/导出 | `web/src/components/blocks/*`、`web/src/diagram/*`、`web/src/flow/*` |
| 10 | DSH 集成方式 | 薄 Client Plugin（TracebookAction/Tab, iframe 嵌入 Vue）+ session postMessage「Ask about this」回灌上下文；不 fork DSH Web | `src/client/*`、`web/src/session.ts` |
| 11 | 关键设计约束与不变式 | 汇总 AGENTS.md 约束在代码中的落点（边界收敛、单写路径、Flow/ELK 分工、稳定 ID upsert 等） | `AGENTS.md` + 各处 |

## 4. 图表清单（均用 Mermaid）

1. **框架结构图**：`flowchart`，展示 Agent / DSH Host / Tracebook(Core·Host·Client) / Web Viewer 及数据流向。
2. **数据模型 ER 图**：`erDiagram`，Case ‖ Block ‖ Artifact ‖ Revision ‖ SessionLink 关系与基数。
3. **Block 类型总览**：表格（9 类）+ 关键字段。
4. **写入交互时序图**：`sequenceDiagram`，Agent→Tool→Service→(Repository + ArtifactStore)→revision。
5. **读取/实时交互时序图**：`sequenceDiagram`，Viewer→HTTP API→Service；SSE `/events` 推送 + 12s 轮询兜底。
6. **存储表布局图**：说明 per-record 五表 + 复合键。

## 5. 边界与约束

- 不修改任何 `src/` 或 `web/` 代码；仅新增一份 md。
- 文档需与当前代码一致；若发现 README 与代码不符，以代码为准并在文中标注。
- 遵守 AGENTS.md：文档描述必须反映「三 Tool 写入、Storage 抽象、Core 不碰 DSH/DB、Flow 与 ELK 分工」等约束。

## 6. 预期结果

一份可独立阅读的 `doc/tracebook-principles.md`：新读者读完能回答「插件在 DSH 里怎么装配、Agent 怎么写数据、数据如何持久化与展示、各层边界在哪」。所有图在 md 中直接渲染，关键处标注 `文件:行` 便于跳转源码。
