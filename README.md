# Tracebook

Tracebook 是运行在 DeepSeek Harness（DSH）上的工程调查结果组织插件。它把 Agent 已经理解出的结果保存为可持续更新的结构化 Case，并提供 Artifact 管理、交互式 Viewer 和跨 Session 上下文复用。

> 当前状态：MVP 已实现，并已在 DSH `0.1.5-rc.3` Web Profile 中完成真实运行验证。Agent 负责探索，Tracebook 负责规范化、持久化、展示与复用。

## MVP 能力

- `tracebook_open`：创建或恢复 Case，并关联当前 Session。
- `tracebook_update`：按稳定 `block.id` 增量 upsert，支持 revision 冲突保护。
- `tracebook_context`：返回适合后续 Agent 使用的压缩 Context。
- DSH Domain Storage：Core 只依赖 `CaseRepository`，DSH 细节集中在 Host adapter。
- 文件 Artifact Store：原子写入 Screenshot、Log、HTTP、Trace 等原始资料，Case 仅保存元数据与引用。
- 同源只读 API：Case List、Case Detail、Blocks 与 Artifact 内容。
- Vue 3 Viewer：Case 列表/搜索、Case 文档、七种 Block Renderer、表格筛选、Gallery、Evidence。
- Vue Flow + ELK.js：流程渲染、自动布局、缩放、Minimap 与 Node Inspector。

支持的 Block：`markdown`、`facts`、`flow`、`table`、`timeline`、`evidence`、`gallery`。

## 安装与构建

要求 Node.js 22 或更高版本。

```bash
npm install --legacy-peer-deps
npm run verify
```

DSH 的能力包声明为宿主 peer dependencies；`--legacy-peer-deps` 可避免 npm 在插件仓库中重复安装整套 Agent Runtime。

本地安装到 DSH Web Profile：

```bash
dsh plugin --profile web add /absolute/path/to/tracebook
dsh --profile web --dump-config
dsh --profile web
```

打开 `http://127.0.0.1:<dsh-port>/tracebook/`。

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
| `seedExampleCase` | 启动时幂等写入一个覆盖 7 类 Block 与 4 类 Artifact 的完整 mock Case |

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
GET /tracebook/api/artifacts/:id
```

## 开发

```bash
npm run typecheck
npm test
npm run build
npm run verify
```

```text
src/core/          领域模型、Schema、Repository、Service
src/host/          DSH Storage、Tool、HTTP、Artifact adapter
web/src/           Vue Viewer
tests/             Core 与 Artifact Store 测试
doc/               设计文档
```

完整架构与产品边界见 [设计方案](doc/tracebook-dsh-plugin-design.md)，尚未完成的用户交互见 [未完成交互说明](doc/tracebook-pending-interactions.md)。
