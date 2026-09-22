# Tracebook

Tracebook 是运行在 DeepSeek Harness（DSH）上的工程调查结果组织插件。它把 Agent 已经理解出的调查结果整理为可持续更新的结构化 Case，并提供持久化、Artifact 管理、交互式查看和上下文复用能力。

> 当前状态：方案设计 / MVP 开发准备阶段。

## 为什么需要 Tracebook

一次工程调查通常会跨越页面、HTTP API、服务、消息队列、Worker、数据库和日志系统。Agent 可以利用现有工具完成探索，但调查结果容易散落在对话与工具输出中，难以跨轮次、跨 Session 延续。

Tracebook 将这些已经确认的结果沉淀为长期存在的工程调查文档：

```text
用户提问
  → Agent 使用现有工具调查
  → Agent 形成新的理解
  → Tracebook 增量更新 CaseDocument
  → Viewer 展示文本、事实、流程、表格、时间线与证据
  → 后续 Agent 读取已有上下文并继续调查
```

Tracebook 组织调查结果，但不负责替代 Agent 进行探索、规划或根因推理。

## 核心概念

- **Case**：一个可跨 Session 持续演进的调查主题，可用于产品现状探索、故障调查或巡检。
- **CaseDocument**：Agent、存储层、API 与前端共同遵守的核心数据协议。
- **Block**：Case 的内容单元，MVP 计划支持 Markdown、Facts、Flow、Table、Timeline、Evidence 和 Gallery。
- **Artifact**：截图、日志、HTTP 响应、Trace 等不适合直接放入 CaseDocument 的大体积原始材料。
- **Context**：从已有 Case 压缩得到、可供后续 Agent 继续调查的背景信息。

## 设计原则

- Agent 决定写入什么，Tracebook 负责协议、校验、存储与展示。
- Case 的生命周期独立于 DSH Session。
- Block 使用稳定 ID 增量 upsert，同一个 Case 随追问逐步生长。
- 结构化数据与大文件分离存储。
- 采用 Structured Document，而非在 MVP 阶段构建全局 Knowledge Graph。
- DSH 耦合集中在 Adapter 层，Core 保持可测试和可迁移。

## 计划中的架构

```text
DSH Agent
  ├─ tracebook_open
  ├─ tracebook_update
  └─ tracebook_context
           │
           ▼
Tracebook Host Plugin
  ├─ Core Protocol / Validation
  ├─ DSH Storage Adapter
  ├─ Artifact Store
  └─ HTTP API + Vue Static Files
           │
           ▼
Vue 3 Viewer
  ├─ Block Renderers
  ├─ Vue Flow
  └─ ELK.js Layout
```

Agent Tool 是主要写入口；Vue Viewer 在 MVP 中主要通过同源 HTTP API 读取并展示 Case。

## MVP 范围

- 定义 CaseDocument、Block 与 Artifact 协议。
- 基于 DSH Storage 持久化 Case，并将大文件保存到 Artifact Store。
- 提供 `tracebook_open`、`tracebook_update`、`tracebook_context`。
- 提供 Case 列表、详情和 Artifact 读取 API。
- 使用 Vue 3 构建 Viewer，并用 Vue Flow + ELK.js 展示流程。
- 完成 DSH Bundle、Host Plugin 与页面入口集成。

MVP 不包含自动探索、自动收集所有 Tool Result、自动根因分析、全局知识图谱和复杂实体消歧。

## 仓库结构

当前仓库仍处于设计阶段：

```text
.
├── AGENTS.md                          # 项目开发约束
├── README.md                          # 项目概览
└── doc/
    └── tracebook-dsh-plugin-design.md # 完整设计与 MVP 开发基线
```

后续代码预计按 Core、DSH Adapter、Agent Tools、HTTP/Artifact、Vue Viewer 等边界逐步落地，具体以设计稿和实际实现为准。

## 开发约定

开始开发前请先阅读：

1. [`AGENTS.md`](./AGENTS.md)：强制执行的项目边界、质量和 Git 规则。
2. [`doc/tracebook-dsh-plugin-design.md`](./doc/tracebook-dsh-plugin-design.md)：详细产品设计、协议草案、架构与 MVP 拆分。

每次开发任务完成并验证通过后，应自动创建一个仅包含本次任务改动的 Conventional Commit；默认不自动 push。
