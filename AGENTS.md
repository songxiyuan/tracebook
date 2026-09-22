# Tracebook 项目约束

本文件是本仓库内所有开发工作的强制约束。除非用户在当前任务中明确覆盖某条规则，否则所有开发者与 Agent 都必须遵守。

## 1. 产品边界

- Tracebook 是 DeepSeek Harness（DSH）上的工程调查结果组织插件，不是 Agent Runtime、探索引擎或自动根因分析系统。
- 核心职责必须保持为：规范化调查结果、持久化 Case、管理 Artifact、展示结果、向后续 Agent 提供上下文。
- Agent 决定调查内容；Tracebook 只定义、校验、存储和展示协议。

## 2. 架构约束

- DSH 相关 API 必须收敛在 adapter / plugin 边界，Core 不得直接依赖 DSH 实现细节。
- Core 不得直接依赖 SQLite 或特定数据库 API，持久化必须通过 Storage 抽象。
- Agent 写入以 `tracebook_open`、`tracebook_update`、`tracebook_context` 三个核心 Tool 为主；新增 Tool 必须有不可由现有 Tool 覆盖的明确理由。
- Block 更新采用稳定 ID 的 upsert 语义，禁止要求调用方反复重写完整 Case。
- Vue 页面优先通过同源 HTTP API 读取数据；未经设计评审，不得同时维护 HTTP API 与 Remote API 两套等价写路径。
- 流程图由 Vue Flow 负责渲染与交互、ELK.js 负责布局，不得把二者职责混合。
- 不 fork 或侵入式修改 DSH Web；集成应通过 Bundle、Host Plugin、静态页面或薄 Client Plugin 完成。

## 3. 实现约束

- 优先保持模块边界清晰，不为尚未出现的需求提前拆分大量 package 或引入复杂基础设施。
- 每次变更对应的文档内容也要更新
  
## 4. Git 与自动提交

- 每次开发任务完成且验证通过后，Agent 必须自动创建一次 Git commit，无需再次询问。
