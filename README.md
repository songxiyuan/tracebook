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
