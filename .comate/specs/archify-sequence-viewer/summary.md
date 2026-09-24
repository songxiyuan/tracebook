# 总结：时序图 archify 迁移 + 统一查看器交互（2026-09-25）

## 结论

时序图已彻底按 archify 迁移（复用其 sequence schema），并为**所有流程图与时序图**补齐了 archify 生成 HTML 的四类交互：语义护照、缩放、演示、导出。分 6 次提交，可选择性回退。

## 提交

- `eb7fea4` feat(sequence): 迁移到 archify sequence schema 并重写为 archify 风格渲染
- `1f475a7` feat(flow): 语义护照面板——身份/上下游可达/邻接边/复制链接 + 选中聚焦
- `c75ba58` feat(sequence): 语义护照面板、可达性透镜与缩放控件
- `8111a0e` feat(diagram): 流程图/时序图导出 SVG 与 PNG
- `5e9507b` feat(diagram): 引导视图演示模式（演示）——流程图/时序图逐步聚焦
- （本提交）docs: 设计文档与优化计划更新 + spec

## 之前"没改彻底"的原因与本次修复

上一轮（batch-D）新增的 sequence block 是 Tracebook 自定义的 participants/messages 形状，只做了"配色轻量对齐"，并未采用 archify 的 sequence schema，也没有 archify 的头部着色/激活条/return 虚线等视觉。本次：
- 数据层新增 `sequenceDiagramSchema` 并入 archify 判别联合，sequence block 支持 `variant: basic|archify`，archify 变体内嵌 archify sequence 文档（schema 完全复用）。
- 渲染层重写 `SequenceBlock.vue`：按 `componentType` 着色的参与者头 + sublabel、虚线生命线、激活条、按 `variant`（default/emphasis/security/dashed/return）分样式的箭头、note、自消息环；`y` 仅用于排序。

## 统一查看器交互（flow + sequence 共享 `web/src/diagram/`）

- **语义护照**：点击节点/参与者 → 面板显示身份、出/入向摘要、上游/下游可达数（BFS）、邻接边（可点击跳转）、复制链接、追问；可达透镜压暗无关节点。
- **缩放**：flow 复用 Vue Flow（含"聚焦到节点"动画）；sequence 用 SVG 盒缩放 + 滚动。
- **演示**：读取 `diagram.meta.views`（archify 引导视图），逐章聚焦并压暗其余，带上/下一步与退出。
- **导出**：sequence 内联样式序列化真实 SVG；flow 由 ELK 几何重绘独立 SVG（`flow-to-svg.ts`）；均可导出 SVG 或 PNG（`diagram-export.ts` 经 canvas 栅格化）。

## 架构与取舍

- 遵守 AGENTS.md：不新增写路径；Flow 仍 Vue Flow 渲染 / ELK 布局；archify 仅作 schema 与视觉语言来源，非运行时库依赖。
- archify sequence 的像素字段（y/viewBox/column_fit）接受并原样保留（round-trip），但几何由组件布局。
- 未做：导出 JPEG/WebP/WebM（archify 有，本轮仅 SVG/PNG）；Flow 双击折叠子树；跨进程实时可见（依赖缺失原语）。

## 验证

`npm run typecheck`（web/client/core）、`npm run build`、`npx vitest run`（75 passed）全绿。
