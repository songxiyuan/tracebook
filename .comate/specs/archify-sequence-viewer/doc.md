# 时序图 archify 迁移 + 统一查看器交互（archify-sequence-viewer）

## 背景

用户反馈：flow 已按 archify 迁移，但 sequence 之前未彻底照 archify 改，样式不好看；且希望所有流程图/时序图都具备 archify 生成 HTML 的交互——单节点点开的"语义护照"、放大、演示、导出。参考文件：`/Users/sxy/Documents/harness/.dsh/skills/archify` 与生成样例 `terabox-upload.sequence.html`。

## 目标

1. 时序图迁移到 archify sequence schema（完全复用），并重写为 archify 风格 SVG 渲染。
2. 为 flow + sequence 补齐统一查看器交互：语义护照、缩放、演示（引导视图）、导出（SVG/PNG）。

## 范围与实现

- 数据层：`src/core/archify.ts` 新增 `sequenceDiagramSchema` 并入判别联合；`sequence` block 增加 `variant: basic|archify` + `diagram`（校验复用 `validateArchifyDiagram`）。
- 渲染层（`web/src/`）：
  - `components/blocks/SequenceBlock.vue` 重写：统一归一化 basic/archify → 行索引模型，archify 风格 SVG（类型着色头、生命线、激活条、variant 箭头、note、自消息环）。
  - `diagram/graph-analysis.ts`：通用有向图 BFS 可达 + 邻接边（flow/sequence 共用）。
  - `diagram/SemanticPassport.vue`：语义护照面板（身份/可达/邻接/复制/追问）。
  - `diagram/diagram-export.ts`：SVG 内联序列化 + canvas 栅格化 PNG。
  - `flow/flow-to-svg.ts`：由 ELK 几何重绘独立 SVG（Vue Flow 节点是 HTML，无法直接序列化）。
  - FlowBlock/SequenceBlock 接入护照、可达透镜、演示、导出。

## 架构约束

遵守 AGENTS.md：不新增等价写路径；Flow 仍 Vue Flow 渲染 / ELK 布局；archify 只作为 schema 与视觉语言来源，不作为运行时库依赖。archify sequence 的像素字段（y/viewBox/column_fit）接受并保留，但几何由组件自行布局。

## 明确未做

- 跨进程实时可见（依赖 storage-domain reload 原语）。
- 导出 JPEG/WebP/WebM（archify 有，但本轮仅 SVG/PNG）。
- Flow 双击折叠子树。

## 验证

`npm run typecheck` / `npm run build` / `npx vitest run`（75 passed）全绿。分多次提交，便于选择性回退。
