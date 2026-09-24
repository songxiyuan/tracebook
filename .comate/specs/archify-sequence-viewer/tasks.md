# 任务计划：时序图 archify 迁移 + 统一查看器交互

- [x] Task 1: 时序图迁移 archify schema + archify 风格渲染
    - 1.1: archify.ts 增 sequenceDiagramSchema，入判别联合与 4 个 helper
    - 1.2: model.ts sequence block 增 variant/diagram + 校验；service/export/tools 兼容
    - 1.3: SequenceBlock.vue 重写为 archify 风格 SVG（两 variant 统一渲染）
    - 1.4: 单测 + 提交（eb7fea4）

- [x] Task 2: 语义护照（flow）
    - 2.1: diagram/graph-analysis.ts（BFS 可达 + 邻接）
    - 2.2: diagram/SemanticPassport.vue
    - 2.3: FlowBlock 接入护照 + 可达透镜 + 选中聚焦 + 复制链接（1f475a7）

- [x] Task 3: 语义护照 + 缩放（sequence）
    - 3.1: SequenceBlock 接入护照、可达透镜、缩放控件（c75ba58）

- [x] Task 4: 导出 SVG/PNG（flow + sequence）
    - 4.1: diagram/diagram-export.ts（内联序列化 + PNG 栅格化）
    - 4.2: flow/flow-to-svg.ts（ELK 几何重绘独立 SVG）
    - 4.3: 两个组件工具栏加 SVG/PNG 按钮（8111a0e）

- [x] Task 5: 演示（引导视图）flow + sequence
    - 5.1: 读取 diagram.meta.views，逐章聚焦压暗，上一/下一步（5e9507b）

- [x] Task 6: 文档与验证收尾
    - 6.1: 更新设计文档 + 优化计划
    - 6.2: typecheck/build/test 全绿 + summary
