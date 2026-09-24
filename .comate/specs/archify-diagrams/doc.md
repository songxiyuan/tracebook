# Archify 流程图重构（archify-diagrams）

## 1. 背景与目标

当前 FLOW block 的连线"乱七八糟"，且只支持一种最简单的图。目标：

1. **修好连线**：让边跟随布局算法算出的正交路由、带箭头、hover 不再变蚂蚁线虚线。
2. **对齐 archify 视觉语言**：节点按 `componentType` 着色、边按语义（main/branch/async/return/error、variant）分样式、支持泳道/分组/图例。
3. **覆盖 archify 全部 5 种图**：workflow、architecture、sequence、dataflow、lifecycle。
4. **复用 archify 的数据 schema**：4 种图（workflow/architecture/dataflow/lifecycle）以 archify 原始 JSON 形态存入 flow block；sequence 复用 Tracebook 已有的 sequence block。

### 架构约束确认（AGENTS.md）

- 「流程图由 Vue Flow 负责渲染与交互、ELK.js 负责布局」——**保留**。archify 是生成静态 HTML 的 CLI（`private:true`、无库导出、自研像素级 SVG 编译器），**无法作为库依赖**引入 Vue 应用，因此不直接依赖其绘制，只**借鉴其视觉语言 + 采用其数据 schema**。此点已与用户确认。
- 「Block 更新采用稳定 ID 的 upsert 语义」——沿用，新增字段不破坏该语义。
- 「每次变更对应文档也要更新」——同步更新 `doc/tracebook-dsh-plugin-design.md`。

## 2. 乱线根因（已定位）

`web/src/components/blocks/FlowBlock.vue`：

- `layoutOptions()`（:161-169）已请求 `elk.edgeRouting: 'ORTHOGONAL'`，但 `layout()` 回读 ELK 结果时只用了 `node.x/node.y`（:186-194），**完全丢弃 `edge.sections`（折线拐点）**。
- 边直接以 `{id,source,target,label,animated:false}` 交给 Vue Flow（:199-201），无 `type`、无 `markerEnd` → Vue Flow 用默认 **bezier 曲线**自行重连，无避障 → 交叉、绕圈。
- `applyHighlight()`（:306-311）hover 时把关联边 `animated=true` → Vue Flow 渲染成**虚线蚂蚁线**。

**修复策略**：回读 ELK `edge.sections` 的 `startPoint / bendPoints / endPoint`，用自定义正交边组件按这些点画圆角折线 + 箭头；hover 改为加粗/变色而非 animated。

## 3. 数据模型设计（`src/core/model.ts`）

### 3.1 flow block 增加 `variant` + `diagram`

保持 `type: 'flow'`，新增判别字段 `variant`，向后兼容现有数据：

```ts
// variant 即 archify 的 diagram_type；basic 为现有的简单图（向后兼容）
export const flowVariantEnum = z.enum(['basic', 'workflow', 'architecture', 'dataflow', 'lifecycle'])

export const flowBlockSchema = blockBaseSchema.extend({
  type: z.literal('flow'),
  variant: flowVariantEnum.default('basic'),
  // variant='basic'：沿用现有字段
  direction: z.enum(['TB', 'BT', 'LR', 'RL']).default('TB'),
  nodes: z.array(flowNodeSchema).optional(),
  edges: z.array(flowEdgeSchema).optional(),
  // variant∈{workflow,architecture,dataflow,lifecycle}：直接内嵌 archify 文档
  diagram: archifyDiagramSchema.optional(),
}).superRefine(...)  // 见 3.3
```

### 3.2 archify 文档 schema（Zod 翻译，"完全复用"）

在 `src/core/model.ts`（或新文件 `src/core/archify.ts`，视体量决定）中，按 archify 的 JSON Schema 逐字段翻译为 Zod，形成判别联合：

```ts
// 与 archify common.schema.json 对齐
const componentTypeEnum = z.enum(['frontend','backend','database','cloud','security','messagebus','external'])
const archifyVariant = z.enum(['default','emphasis','security','dashed'])
const sideEnum = z.enum(['left','right','top','bottom'])
const point = z.tuple([z.number(), z.number()])

// workflow：lanes + nodes(lane,col,type) + edges(from,to,role,variant) + phases/groups/mainPath...
// architecture：components(row,col,type) + boundaries(wraps) + connections(from,to)
// dataflow：stages + nodes(stage,row,type) + flows(from,to,classification)
// lifecycle：lanes + states(lane,col,type∈start/active/waiting/decision/success/failure/neutral/external) + transitions(from,to)
export const archifyDiagramSchema = z.discriminatedUnion('diagram_type', [
  workflowDiagramSchema, architectureDiagramSchema, dataflowDiagramSchema, lifecycleDiagramSchema,
])
```

**忠实但务实的取舍（关键，请评审）**：archify schema 中大量字段是为其**自研像素级 SVG 编译器**服务的纯布局/坐标提示——`viewBox`、`via`、`channelX/Y`、`route`、`fromSide/toSide`、`labelDx/Dy/labelAt/labelSegment`、`pos`、`size`、`width`、`col`/`row` 的像素含义等。Tracebook 用 **ELK 自动布局 + Vue Flow 渲染**，几何由 ELK 决定（AGENTS.md 强约束）。因此：

- **语义字段**（`lane`、`col`/`stage`/`row` 作为**逻辑序**、`type`、`role`、`variant`、`label`、`sublabel`、`tag`、`boundaries`、`mainPath`）→ 驱动 ELK 分层/分组与 Vue Flow 样式。
- **像素/路由提示字段** → schema 接受并**原样存储**（保证 round-trip、便于未来导出 archify JSON），但**渲染时忽略**，几何一律由 ELK 计算。

这样"数据 schema 完全复用"（存的就是合法 archify JSON），同时不违反"ELK 负责布局"。

### 3.3 校验（superRefine）

- `variant='basic'`：要求 `nodes` 存在；沿用现有唯一 ID / 悬空边校验。
- `variant∈{workflow,...}`：要求 `diagram` 存在且其 `diagram_type` 与 `variant` 一致；对 diagram 内部做唯一 ID + 引用完整性校验（边的 from/to、boundaries.wraps、mainPath 必须指向存在的节点）。
- sequence 不在此处，走既有 `sequenceBlockSchema`（复用）。

### 3.4 schema 提示同步

更新 `buildBlockSchemaReference()` 的手写兜底 `HAND_WRITTEN_BLOCK_REFERENCE`（:438-448）中 `flow` 行，加入 `variant` 与各 diagram 形态摘要，供 Agent 构造合法 block。

## 4. 渲染设计（`web/`）

### 4.1 归一化层（新文件 `web/src/flow/normalize.ts`）

把任意 variant 的图归一为内部图，供 ELK + Vue Flow 使用：

```ts
interface NormNode { id; label; kind?; sublabel?; tag?; group?; rank?; shape?: 'box'|'diamond'|'pill'; details?; artifactRefs?; metadata? }
interface NormEdge { id; source; target; label?; role?: 'main'|'branch'|'async'|'return'|'error'; variant?; }
interface NormGraph { nodes: NormNode[]; edges: NormEdge[]; groups: {id,label,members:string[]}[] }

export function normalize(block: FlowBlock): NormGraph
```

映射规则：
- **basic**：现有 `nodes/edges` 直通（`kind` → 颜色）。
- **workflow**：`node.type`→kind、`node.lane`→group、`node.col`→rank；`edge.from/to`→source/target、`edge.role`/`variant`→边样式；`lanes`→groups；`phases/groups` 作为背景分组（可选）。
- **architecture**：`components`（`type`→kind、`row/col`→rank/次序）；`connections.from/to`→边；`boundaries.wraps`→groups（安全组/区域背景框）。
- **dataflow**：`nodes.stage`→rank、`stage` 标签→列头；`flows.from/to`→边、`classification`→边标签/样式。
- **lifecycle**：`states.type`→kind + `shape`（`decision`→diamond、`start/success/failure`→pill）、`lane`→group、`col`→rank；`transitions.from/to`→边。

### 4.2 ELK 布局升级（新文件 `web/src/flow/elk-layout.ts`，从 FlowBlock 抽出）

- 用逻辑序约束尊重 archify 的列/阶段顺序：开启 `elk.partitioning.activate`，为节点设 `elk.partitioning.partition = rank`（col/stage）。
- 泳道/分组：用 ELK 层级容器（children 嵌套）或 `elk.layered.crossingMinimization.semiInteractive`，让同 group 节点聚拢；group 背景框用 ELK 计算出的容器 bbox。
- **回读 `graph.edges[].sections`**：导出 `{ id, points: [{x,y}...] }`（start + bendPoints + end），供自定义边使用。这是修好乱线的核心。
- 保留现有方向自动判定 `pickAutoDirection()` 与 TB/LR/BT/RL 切换。

### 4.3 自定义正交边（新文件 `web/src/flow/OrthogonalEdge.vue`）

- 注册为 Vue Flow 自定义 edge type（`edges` 项带 `type:'orthogonal'`、`data.points`）。
- 用 ELK 折线点画**圆角正交路径**（`L`/圆角拐角），末端加**箭头 marker**。
- 按 `role/variant` 分样式：main 实线较粗、branch 常规、async/dashed 虚线、return 次要色、error 用 `--security` 红。
- hover 高亮：改为**加粗 + 变色**（`--frontend`），**移除 `animated`**（不再蚂蚁线）。ELK 缺 `sections` 时回退到 `smoothstep`（仍是直角，不用 bezier）。

### 4.4 节点渲染（`FlowBlock.vue` 模板 + `styles.css`）

- 卡片式节点：`kind`（componentType）→ 左边框/文字强调色（复用现有 `--frontend/...` 变量，配色已与 archify 对齐）。
- 支持 `sublabel`（次要说明）与 `tag`（角标 chip）。
- lifecycle 的 `decision` 渲染为菱形、`start/success/failure` 渲染为胶囊；其余为圆角矩形。
- 泳道/分组：Vue Flow group 节点或 SVG 背景框（非交互）+ 组标题。

### 4.5 图例与工具栏

- 复用现有 kind 图例（:411-420），改为按出现的 componentType 生成，兼作过滤器。
- 工具栏保留 Layout/Fit/Fit width/100%/Map/Find node；basic 与各 variant 共用。

### 4.6 sequence（复用既有 block）

- **不改数据模型**：sequence 继续走 `sequenceBlockSchema`（participants/messages）与既有 `SequenceBlock.vue`。这是本次唯一不采用 archify schema 的类型（尊重"复用已有 sequence block"）。
- 仅做**视觉轻量对齐**：participant/message 配色、箭头样式向 archify 靠拢（sync/async/stream → 实线/虚线/流式）。
- ⚠️ 待评审点：若你希望 sequence 也改用 archify 的 sequence schema（participants{type}、messages{y,variant}），请在评审时说明；默认保持既有 block 不动。

## 5. 影响文件清单

**新增**
- `web/src/flow/normalize.ts` — archify 图 → 内部 NormGraph。
- `web/src/flow/elk-layout.ts` — ELK 选项 + 分区/分组 + 回读 edge.sections。
- `web/src/flow/OrthogonalEdge.vue` — ELK 折线正交边（箭头/语义样式）。

**修改**
- `src/core/model.ts` — flow block 增 `variant`/`diagram`；新增 archify Zod schema 与判别联合；superRefine 扩展；`HAND_WRITTEN_BLOCK_REFERENCE` 的 flow 行更新。
- `web/src/components/blocks/FlowBlock.vue` — 接入 normalize + elk-layout + 自定义边 + 节点类型/形状 + 泳道分组；hover 不再 animated。
- `web/src/styles.css` — archify 风格节点/边/泳道/图例样式（`.flow-node`、`.vue-flow__edge*` 区块 ~903-936）。
- `src/host/tools.ts` — `tracebook_update`/schema 提示描述补充 flow 的 variant 与 diagram 形态。
- `doc/tracebook-dsh-plugin-design.md` — 记录 flow 多形态与 archify schema 采用（AGENTS.md 要求文档同步）。
- `tests/model.test.ts` — 新增各 variant 的 schema 校验用例（合法/非法：diagram_type 不匹配、悬空引用等）。

## 6. 边界与异常

- **向后兼容**：现有 flow block 无 `variant` → 默认 `basic`，`nodes/edges` 渲染路径不变，存量 Case 不受影响。
- **悬空引用**：diagram 内边指向不存在节点 → 布局前过滤（沿用现有 `safeEdges` 思路），schema 层也拒绝。
- **ELK 失败**：保留现有 `layoutError` 可读报错，不白屏。
- **像素提示字段缺失/冲突**：忽略即可，ELK 兜底。
- **未知 kind / type**：回退到 `--external` 中性色。

## 7. 数据流

Agent 调 `tracebook_update` 写入 flow block（basic 或内嵌 archify diagram）→ `model.ts` 校验并存储 → HTTP API 读出 → `FlowBlock.vue` 调 `normalize()` → `elk-layout` 计算坐标与边折线点 → Vue Flow 用自定义正交边 + 类型化节点渲染。

## 8. 预期结果

- 连线为**正交折线 + 箭头**，跟随 ELK 避障路由，不再交叉绕圈；hover 高亮为加粗变色而非虚线。
- flow block 支持 workflow/architecture/dataflow/lifecycle 四种 archify 图，节点按类型着色、支持泳道/分组/图例；sequence 复用既有 block 并轻量对齐视觉。
- 存储的 diagram 为合法 archify JSON（schema 完全复用），几何由 ELK 保证美观。
- 全量类型检查/构建/测试通过，文档同步更新，任务完成后自动 commit。
