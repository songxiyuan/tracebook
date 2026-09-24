# Archify 流程图重构总结

## 目标回顾

修复流程图连线"乱七八糟"的问题，让它更好看；参考 archify 支持其全部 5 种图类型，并复用 archify 的数据 schema。

## 完成情况

10 个任务全部完成，typecheck / build / 全量测试（73 passed）通过，已自动提交（commit `6de9516`）。

### 乱线根因与修复

根因：`FlowBlock.vue` 请求了 ELK `ORTHOGONAL` 路由但只用了节点坐标，**丢弃了 ELK 算好的边折线拐点**，边以无 type 的形式交给 Vue Flow → 默认 bezier 曲线自行重连、无避障；hover 又把边设为 `animated` → 蚂蚁线虚线。

修复：回读 ELK `edge.sections`，用自定义正交边按折线点画圆角路径 + 箭头；hover 改为加粗变色。

### 架构决策（已与用户确认）

archify 是生成静态 HTML 的 CLI（`private:true`、无库导出、自研像素级 SVG 编译器），**无法作为库依赖**引入 Vue 应用，且 AGENTS.md 强制流程图用 Vue Flow + ELK。因此：保留 Vue Flow + ELK 渲染，**借鉴 archify 的视觉语言 + 完全复用其数据 schema**，不直接依赖其绘制。

## 关键变更

**数据层**
- 新增 `src/core/archify.ts`：逐字段翻译 archify 的 common/workflow/architecture/dataflow/lifecycle JSON Schema 为 Zod，条目用 loose object 保留像素/路由提示字段（round-trip）。
- `src/core/model.ts`：flow block 增加 `variant` + `diagram`，`basic` 向后兼容；superRefine 校验 variant/diagram_type 一致性、唯一 ID 与引用完整性（from/to、boundaries.wraps、mainPath）。
- `src/core/service.ts`：context 压缩与引用检查兼容两种 flow 形态。
- `src/host/tools.ts` + schema 提示：补充 flow variant/diagram 说明。

**渲染层（`web/src/flow/`）**
- `normalize.ts`：任意 variant → 统一 `NormGraph`（nodes/edges/groups + hasRanks）。
- `elk-layout.ts`：按逻辑序开启 ELK 分区、回读 edge.sections 折线点、计算泳道/分组背景框。
- `OrthogonalEdge.vue`：ELK 折线圆角正交边 + 箭头，按 role/variant 着色。
- `FlowBlock.vue`：接入上述模块；节点按 componentType 着色、支持 sublabel/tag、lifecycle 菱形/胶囊、泳道分组框；hover 不再 animated；图例按类型生成。
- `styles.css`：节点/边/泳道/图例样式，新增 lifecycle 状态色，去掉边 stroke 的 `!important` 让每条边的语义色生效。

**sequence**：复用既有 block，async/stream 改虚线、hover 色对齐调色板（不改数据模型）。

## 支持的图类型

| variant | archify diagram_type | 状态 |
| --- | --- | --- |
| basic | —（Tracebook 原生拓扑图） | 兼容保留 |
| workflow | workflow | 新增 |
| architecture | architecture | 新增 |
| dataflow | dataflow | 新增 |
| lifecycle | lifecycle | 新增 |
| sequence | sequence | 复用既有独立 block |

## 忠实但务实的取舍

archify schema 中的像素/路由提示字段（viewBox、via、channelX/Y、route、fromSide/toSide、labelDx/Dy、pos、size、width 等）会被 schema 接受并原样存储，但**渲染时忽略**——几何一律由 ELK 计算，符合"Vue Flow 渲染 / ELK 布局"约束。这样"数据 schema 完全复用"（存的就是合法 archify JSON），同时布局美观由 ELK 保证。

## 验证

- `npm run typecheck`：通过（web / client / core）
- `npm run build`：通过（FlowBlock 为独立异步 chunk，elkjs 体积较大属预期）
- `npx vitest run`：73 passed（含新增的 variant 合法/非法用例）

## 后续可选项

- 若希望 sequence 也改用 archify 的 sequence schema（participants{type}、messages{y,variant}），需单独评审改造既有 sequence block。
- archify 的 cards / guidedViews / legend 等元信息目前存储但未在 Viewer 呈现，可按需接入。
