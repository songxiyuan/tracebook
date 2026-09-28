# 总结：Tracebook 原理说明文档

## 交付物

- 新增 `doc/tracebook-principles.md`（约 420 行），从当前 `main` 代码整理的原理总览。
- SDD 过程产物：`.comate/specs/tracebook-principles-doc/{doc.md, tasks.md}`。
- 已提交一次 Git commit（`5f50bbe`），未触碰工作区里既存的无关改动 `web/src/components/blocks/FlowBlock.vue`。

## 文档覆盖内容

| 章节 | 内容 |
| --- | --- |
| 1 定位与边界 | 协议组织插件，非探索/根因引擎；五项核心职责 |
| 2 框架结构图 | Core/Host/Client/Web 四层 Mermaid flowchart + 职责表 + 依赖方向 + 插件装配生命周期 |
| 3 Block vs Artifact | 叙事 vs 证据对照，边界约定 |
| 4 数据模型 | Case/Block/Artifact/Revision/SessionLink 的 ER 图；9 种 block 字段表；稳定 id upsert / blockOrder / revision no-op 语义 |
| 5 写入协议 | open/update/context 三 Tool 入参、语义、限额、warnings、单块全文 |
| 6 交互时序图 | 写入链（Agent→Tool→Service→Repository/ArtifactStore）与读取/实时链（HTTP + SSE + 轮询兜底）两张 sequence 图 |
| 7 持久化 | CaseRepository/ArtifactStore 抽象、per-record 五表布局图、三段式原子提交 |
| 8 Artifact | 两种 store、path 白名单/CSP/mime 优先/caseId 路由/回收等安全约束 |
| 9 Viewer | BlockRenderer 分发、Flow=Vue Flow+ELK 分工、语义护照/可达透镜/缩放/演示/导出 |
| 10 DSH 集成 | 薄 Client Plugin + iframe + postMessage「Ask about this」 |
| 11 约束与不变式 | 汇总 AGENTS.md 约束在代码中的落点 + 已知边界 |

## 依据与准确性

- 关键结论逐条核对源码并标注 `文件:行`：`src/index.ts`、`src/core/{model,service,repository}.ts`、`src/host/{tools,http,storage,artifact-store}.ts`、`web/src/{api,session}.ts`、`web/src/components/blocks/BlockRenderer.vue`、`src/client/index.tsx`。
- 图表统一用 Mermaid（flowchart / erDiagram / sequenceDiagram），md 原生可渲染；ER 图属性类型已规避 `[]` 等易导致解析失败的写法。

## 说明

本任务为纯文档整理，未改动任何 `src/`、`web/` 业务代码，无需运行构建/测试；文档内容与当前代码一致，README 与代码若有出入以代码为准。
