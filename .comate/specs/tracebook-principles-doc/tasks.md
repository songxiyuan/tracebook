# Tracebook 原理文档编写任务计划

- [x] Task 1: 精读核对关键源码，锁定事实与行号
    - 1.1: 核对 `src/core/model.ts`（Case/9 类 Block/Artifact/Revision schema、upsert 基线、blockOrder、限额常量）
    - 1.2: 核对 `src/core/service.ts`（open/update/context、三段式提交、no-op 不涨 revision、warnings、onChange）
    - 1.3: 核对 `src/core/repository.ts` + `src/host/storage.ts`（Repository 抽象、per-record 五表、复合键）
    - 1.4: 核对 `src/host/http.ts`、`src/host/artifact-store.ts`、`web/src/api.ts`、`web/src/session.ts`（读取链路、SSE、Artifact 存取、Ask 回灌）

- [x] Task 2: 编写文档骨架与「定位/边界」章节
    - 2.1: 在 `doc/tracebook-principles.md` 建立标题、目录、文档元信息（依据版本/日期）
    - 2.2: 第 1 章：一句话定位 + 产品边界（对齐 AGENTS.md §1）
    - 2.3: 第 11 章占位：关键设计约束与不变式清单

- [x] Task 3: 编写框架结构与分层（含框架结构图）
    - 3.1: 第 2 章：四层架构 Mermaid flowchart + 数据流向
    - 3.2: 各层职责表 + 依赖方向约束（Core 不依赖 DSH/DB）
    - 3.3: 插件装配说明（`src/index.ts` 的 inject/apply/effect 生命周期）

- [x] Task 4: 编写核心概念与数据模型（含 ER 图）
    - 4.1: 第 3 章：Block vs Artifact 对照表
    - 4.2: 第 4 章：Case/Block/Artifact/Revision ER 图（Mermaid erDiagram）
    - 4.3: 9 类 Block 总览表 + 关键字段（含 flow/sequence 的 basic|archify 变体）
    - 4.4: upsert-by-stableId、blockOrder、revision 快照语义说明

- [x] Task 5: 编写 Agent 写入协议（3 个 Tool）
    - 5.1: 第 5 章：三 Tool 入参与语义（open/update/context）
    - 5.2: 限额、base64 校验、warnings、deleteIds、context 单块全文与 query 投影

- [x] Task 6: 编写交互时序图与持久化/Artifact 链路
    - 6.1: 第 6 章：写入交互时序图（Agent→Tool→Service→Repository/ArtifactStore）
    - 6.2: 第 6 章：读取/实时时序图（Viewer→HTTP，SSE `/events` + 轮询兜底）
    - 6.3: 第 7 章：存储抽象 + per-record 五表布局图 + 三段式原子提交
    - 6.4: 第 8 章：Artifact 存取链路（两种 store、path 不出模型、caseId 路由、CSP、mime 优先、白名单摄取）

- [x] Task 7: 编写 Viewer 渲染与 DSH 集成
    - 7.1: 第 9 章：BlockRenderer 分发 + 9 种渲染器；Flow=Vue Flow + ELK.js 分工；语义护照/可达透镜/缩放/演示/导出
    - 7.2: 第 10 章：薄 Client Plugin + iframe 嵌入 + session postMessage「Ask about this」

- [x] Task 8: 收尾校对与提交
    - 8.1: 补齐第 11 章约束清单；通读校对图表可渲染、行号引用准确、与代码一致
    - 8.2: 自动创建一次 Git commit（遵守 AGENTS.md §4）
    - 8.3: 生成 `summary.md`
