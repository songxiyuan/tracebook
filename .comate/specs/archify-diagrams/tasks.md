# Archify 流程图重构任务计划

- [x] Task 1: 数据模型层——采用 archify schema 并扩展 flow block
    - 1.1: 在 model.ts（或新建 src/core/archify.ts）翻译 archify common 定义为 Zod（componentType、variant、side、point、legend、cards 等）
    - 1.2: 翻译 workflow/architecture/dataflow/lifecycle 四个 schema 为 Zod，组成 diagram_type 判别联合 archifyDiagramSchema
    - 1.3: flowBlockSchema 增加 variant 字段与可选 diagram；nodes/edges 改为可选（basic 时必填）
    - 1.4: 扩展 superRefine：variant/diagram_type 一致性、diagram 内唯一 ID 与引用完整性（from/to、wraps、mainPath）
    - 1.5: 导出相关 TS 类型，保持 basic 向后兼容

- [x] Task 2: schema 提示与工具描述同步
    - 2.1: 更新 HAND_WRITTEN_BLOCK_REFERENCE 的 flow 行，加入 variant 与各 diagram 形态摘要
    - 2.2: 更新 src/host/tools.ts 中 flow 相关提示/描述
    - 2.3: 校验 buildBlockSchemaReference 自动生成结果可读

- [x] Task 3: 模型层单测
    - 3.1: 新增 tests/model.test.ts 用例——basic 兼容、四种 variant 合法样例
    - 3.2: 非法用例——diagram_type 与 variant 不符、悬空 from/to、重复 ID
    - 3.3: 运行测试通过

- [x] Task 4: 前端归一化层 normalize.ts
    - 4.1: 定义 NormNode/NormEdge/NormGraph 接口
    - 4.2: 实现 basic 直通与 workflow 映射（lane→group、col→rank、type→kind、role/variant→边样式）
    - 4.3: 实现 architecture（components/boundaries/connections）与 dataflow（stages/nodes/flows）映射
    - 4.4: 实现 lifecycle 映射（state type→kind+shape、lane→group、col→rank）

- [x] Task 5: ELK 布局层 elk-layout.ts
    - 5.1: 从 FlowBlock 抽出 ELK 选项构建，接入 rank 分区（elk.partitioning）
    - 5.2: 泳道/分组容器布局与 group bbox 计算
    - 5.3: 回读 graph.edges[].sections，导出每条边的折线点数组
    - 5.4: 保留方向自动判定与 TB/LR/BT/RL 切换

- [x] Task 6: 自定义正交边 OrthogonalEdge.vue
    - 6.1: 注册为 Vue Flow 自定义 edge type，按 ELK 折线点画圆角正交路径
    - 6.2: 末端箭头 marker；按 role/variant 分样式（main/branch/async/return/error）
    - 6.3: 无 sections 时回退直线段（不用 bezier）

- [x] Task 7: FlowBlock.vue 集成
    - 7.1: 接入 normalize + elk-layout；边改用 orthogonal 类型并传入折线点
    - 7.2: 节点类型化渲染（kind 着色、sublabel、tag）与 lifecycle 形状（菱形/胶囊）
    - 7.3: 泳道/分组背景框与组标题渲染
    - 7.4: 修复 hover——加粗变色替代 animated 虚线；图例改按 componentType 生成

- [x] Task 8: 样式对齐 archify（styles.css）
    - 8.1: 节点卡片/类型强调色/角标样式
    - 8.2: 边样式（实线/虚线/语义色/箭头）与 hover/focus/dim
    - 8.3: 泳道/分组/图例样式

- [x] Task 9: sequence 视觉轻量对齐
    - 9.1: SequenceBlock.vue 配色与 sync/async/stream 箭头样式向 archify 靠拢（不改数据模型）

- [x] Task 10: 文档与验证收尾
    - 10.1: 更新 doc/tracebook-dsh-plugin-design.md（flow 多形态与 archify schema 采用）
    - 10.2: 运行 typecheck / build / 全量测试并修复
    - 10.3: 任务完成后自动 git commit
