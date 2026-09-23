# Tracebook

Tracebook 是运行在 DeepSeek Harness（DSH）上的工程调查结果组织插件。它把 Agent 已经理解出的结果保存为可持续更新的结构化 Case，并提供 Artifact 管理、交互式 Viewer 和跨 Session 上下文复用。

> 当前状态：MVP 已实现，并已在 DSH `0.1.5-rc.3` Web Profile 中完成真实运行验证。Agent 负责探索，Tracebook 负责规范化、持久化、展示与复用。

## MVP 能力

- `tracebook_open`：创建或恢复 Case，并关联当前 Session。
- `tracebook_update`：按稳定 `block.id` 增量 upsert，支持 revision 冲突保护。
- `tracebook_context`：返回适合后续 Agent 使用的压缩 Context。
- DSH Domain Storage：Core 只依赖 `CaseRepository`，DSH 细节集中在 Host adapter。
- 文件 Artifact Store：原子写入 Screenshot、Log、HTTP、Trace、HAR 等原始资料，Case 仅保存元数据与引用。
- 同源只读 API：Case List、Case Detail、Blocks、Artifact 内容、Session 关联与 Revision 历史。
- Vue 3 Viewer：Case 列表/搜索、Block 搜索、Case 文档、八种 Block Renderer、API 接口详情（输入输出 / 耗时来源 / HAR 单次请求瀑布）、表格筛选、Artifact 类型筛选与内嵌预览、Gallery、Evidence。
- 视觉系统：白色页面 + Archify 风格的平面 + 1px 描边 + mono 前置 + 语义色，高密度信息布局（规范见设计文档 13.1）。
- Vue Flow + ELK.js：流程渲染、自动布局、缩放、Minimap、Node Inspector 与 Layout 切换；Node Inspector 内嵌节点图片 Artifact 缩略图。
- 更新提示：轮询 revision，提示新版本并在刷新时保留滚动位置与 Flow 选中项。
- `Ask about this`：从 Flow Node / Evidence / API endpoint 携带上下文回到当前 DSH 对话输入框（只填入草稿，不自动发送）。
- DSH 原生入口：会话标题栏 `Tracebook` 按钮，经 Right Sidebar 打开当前 Session 的 Case。

支持的 Block：`markdown`、`facts`、`flow`、`table`、`timeline`、`evidence`、`gallery`、`api`。

`api` Block 承载接口清单与详情：每个 endpoint 可带 request（params / body）、responses（状态码 / 示例 / Artifact 引用）与 timing。协议对「数据从哪来」是强约束的：

- `timing.source` 必填（`trace` / `har` / `log` / `metrics` / `estimated`），Viewer 把实测与「估算」分开呈现。
- 任何 `example` 必须带 `source`（`observed` / `spec` / `inferred`），编造的示意值和真实抓到的响应不会长得一样。
- 分位数必须带 `sampleSize` 与 `errorCount`（RED），错误率由二者推导；`window` 界定聚合区间。
- 声明耗时（SLO）用 endpoint 上的 `expectedMs` / `expectedRef`，与实测分开；只有声明过的阈值才会给数字上色。
- 当 `timing.source` 为 `har` 且 `artifactRef` 指向 HAR Artifact 时，展开 endpoint 会用 `@cloudflare/waterfall` 画单次请求瀑布；无法读取或无匹配请求时回退到相位汇总条。渲染器与样式按需懒加载，不进主 bundle。

协议细节见设计文档 7.8 节；为什么不复用 OpenAPI 渲染器见 [决策记录](docs/research/openapi-renderer-decision.md)。

## 安装与构建

要求 Node.js 22 或更高版本。

```bash
npm ci
npm run verify
```

DSH 的能力包对外声明为宿主 peer dependencies；本地 link 开发时，Node 会优先从
Tracebook 自己的 `node_modules` 解析，因此 lockfile 同时固定了与 DSH `0.1.5-rc.3`
匹配的完整 peer graph。不要使用 `--legacy-peer-deps`，否则会跳过这些运行时依赖并导致
插件启动失败。`npm ci` 会通过 `prepare` 钩子自动构建 `dist/`。

本地安装到 DSH Web Profile：

```bash
dsh plugin --profile web add /absolute/path/to/tracebook
dsh --profile web --dump-config
dsh --profile web
```

打开 `http://127.0.0.1:<dsh-port>/tracebook/`，或直接点击会话标题栏的 `Tracebook` 按钮。

> 装到另一台电脑、离线 tarball 安装、升级与排错见 **[安装与部署](doc/install.md)**。

修改 Host Plugin 或 Client Plugin 之后需要重启 `dsh web`：Host 侧重新加载 `dist/index.js`，浏览器侧重新扫描 `dsh.client` 并加载 `dist/client.js`；只刷新页面不够。仅修改 Vue 时重新 `npm run build:web` 并刷新页面即可。

## 配置

Bundle 默认插入一个 `tracebook` Host plugin。可在 Profile patch 中覆盖配置：

```yaml
- update:
    id: tracebook
    config:
      artifactDirectory: /absolute/path/to/tracebook-data/artifacts
```

| 字段 | 用途 |
| --- | --- |
| `artifactDirectory` | Artifact 文件目录，默认 `.tracebook/artifacts` |
| `webDirectory` | 自定义已构建 Viewer 目录，默认使用包内 `dist/web` |
| `metadataOnlyArtifacts` | 仅保存 Artifact 元数据，不写入 payload；主要用于受限部署和测试 |
| `seedExampleCase` | 启动时幂等写入一个覆盖 8 类 Block 与 5 类 Artifact 的完整 mock Case |

Storage backend 由 DSH `storage-domain` 路由决定，Tracebook 不直接依赖 SQLite。

## Agent Tool 示例

创建 Case：

```json
{
  "title": "PPT 生成功能",
  "type": "exploration",
  "environment": "production",
  "sourceSessionId": "session-123"
}
```

增量更新：

```json
{
  "caseId": "ppt-generation-a1b2c3d4",
  "expectedRevision": 1,
  "summary": "已确认 Page → API → Service 链路。",
  "upsertBlocks": [
    {
      "id": "backend-flow",
      "type": "flow",
      "title": "后端调用链",
      "direction": "TB",
      "nodes": [
        { "id": "page", "label": "PPT Page", "kind": "page" },
        { "id": "api", "label": "POST /slides/generate", "kind": "api" }
      ],
      "edges": [
        { "id": "page-api", "source": "page", "target": "api", "label": "CALLS" }
      ]
    }
  ]
}
```

读取已有 Context：

```json
{
  "caseId": "ppt-generation-a1b2c3d4",
  "query": "callback",
  "maxBlocks": 8
}
```

## HTTP API

Viewer 使用同源只读 API；MVP 的唯一业务写入口是 Agent Tool。

```text
GET /tracebook/api/cases
GET /tracebook/api/cases/:id
GET /tracebook/api/cases/:id/blocks
GET /tracebook/api/cases/:id/revision
GET /tracebook/api/cases/:id/revisions
GET /tracebook/api/cases/:id/revisions/:revision
GET /tracebook/api/sessions/:sessionId/cases
GET /tracebook/api/artifacts/:id
```

## Client Plugin

`src/client/` 是很薄的一层浏览器插件，只做三件事：

1. 在会话标题栏注册 `Tracebook` 按钮，打开当前 Session 的 Case（Right Sidebar，失败退化为新标签）。
2. 在 Right Sidebar 注册 `tracebook` page tab，用同源 iframe 承载 Vue SPA。
3. 监听 Viewer 的 `postMessage`，把 `Ask about this` 文本追加到当前对话草稿。

构建产物是 DSH Client Modules 期望的 lazy-CJS bundle：

```bash
npm run build:client   # → dist/client.js + dist/client.js.map
```

`package.json` 通过 `exports["./client"]` 与 `dsh.client` 声明；宿主启动时按 profile 扫描加载。

## 开发

```bash
npm run typecheck
npm test
npm run build
npm run verify         # typecheck → build → test（built-viewer 测试需要 dist/web）
```

```text
src/core/          领域模型、Schema、Repository、Service、HAR 匹配
src/host/          DSH Storage、Tool、HTTP、Artifact adapter
src/client/        DSH 薄 Client Plugin（入口、Tab、追问桥接）
web/src/           Vue Viewer
scripts/           Client bundle 构建
tests/             Core、HTTP 路由、HAR 匹配与构建产物测试
doc/               设计文档
docs/research/     调研与决策记录
```

完整架构与产品边界见 [设计方案](doc/tracebook-dsh-plugin-design.md)，交互补齐的范围、落地位置与验收见 [交互补齐说明](doc/tracebook-pending-interactions.md)。
