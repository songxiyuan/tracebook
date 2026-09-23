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

协议细节见设计文档 7.8 节；为什么不复用 OpenAPI 渲染器见 [决策记录](https://github.com/songxiyuan/tracebook/blob/main/docs/research/openapi-renderer-decision.md)。

## 安装

Tracebook 以 DSH Bundle 形式装载：不引入第二套 runtime，也不修改 DSH Web。

| 前置条件 | 要求 |
| --- | --- |
| Node.js | ≥ 22 |
| DSH | `npm i -g @deepseek-ai/dsh`，需提供 `dsh` 命令 |
| pnpm | `dsh plugin` 是 pnpm 的薄转发器，用 PATH 上的 `pnpm` |

### 方式 1：从 npm 安装（推荐）

```bash
dsh plugin --profile web add @songxiyuan/dsh-tracebook
dsh --profile web --dump-config      # 组合后的配置树里应出现 tracebook 行
dsh web
```

包内已含构建产物（`dist/index.js`、`dist/client.js`、`dist/web/`），目标机器不需要 Node 构建环境，也不需要额外的构建脚本授权。

### 方式 2：从源码安装

改代码、跟主干时用这条，后续 `git pull` 即可升级。

```bash
git clone https://github.com/songxiyuan/tracebook.git
cd tracebook
npm ci                               # prepare 钩子自动构建 dist/
dsh plugin --profile web add "$(pwd)"
dsh --profile web --dump-config
dsh web
```

`dsh plugin add` 接受包名、tarball、本地目录等 pnpm 支持的写法。本地目录会被锚定为 `link:` 依赖，命令结束时把 `dsh.profile.bundles` 与被安装的依赖状态对齐——Tracebook 声明了 `dsh.bundle`，所以会自动进入层栈，**不需要手改 profile 的 `package.json`**：

```json
{
  "dependencies": { "@songxiyuan/dsh-tracebook": "link:/path/to/tracebook" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@songxiyuan/dsh-tracebook"] } }
}
```

> link 安装会保留源码仓库的真实路径，Node 优先从仓库自己的 `node_modules` 解析 DSH 能力包，因此仓库 lockfile 固定了与 DSH `0.1.5-rc.3` 对齐的完整 peer graph。**不要使用 `--legacy-peer-deps`**：跳过这些传递 peer 会让直接依赖遮蔽宿主包，插件启动时报 `ERR_MODULE_NOT_FOUND`。

目标机器没有构建环境时，先在有源码的机器上打包，再把 tarball 拷过去（约 670 KB）：

```bash
npm pack                             # → songxiyuan-dsh-tracebook-0.1.0.tgz
scp songxiyuan-dsh-tracebook-0.1.0.tgz user@other-machine:/tmp/
dsh plugin --profile web add /tmp/songxiyuan-dsh-tracebook-0.1.0.tgz
```

装好后打开 `http://127.0.0.1:<dsh-port>/tracebook/`，或直接点击会话标题栏的 `Tracebook` 按钮。

### 验证安装

```bash
dsh --profile web --dump-config | grep -A3 tracebook   # 组合后的树里有 tracebook 行
dsh web
curl -s http://127.0.0.1:<port>/tracebook/api/cases    # 同源只读 API 有响应
```

### 升级与卸载

| 安装方式 | 升级步骤 |
| --- | --- |
| npm | `dsh plugin --profile web add @songxiyuan/dsh-tracebook@<新版本>` |
| 源码（link） | `git pull && npm ci` |
| 离线 tarball | 重新 `npm pack`，再 `dsh plugin --profile web add <新 tgz>` |

```bash
dsh plugin --profile web remove @songxiyuan/dsh-tracebook
```

`dsh.profile.bundles` 里的条目会随依赖移除自动清理。Artifact 文件与 Case 数据不会被删除，需要时手动清理 `artifactDirectory` 与对应 storage。

### 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 启动时报 DSH peer 包 `ERR_MODULE_NOT_FOUND` | 用了 `--legacy-peer-deps`，link 依赖树不完整 | 删除 `node_modules` 后重跑 `npm ci` |
| `dump-config` 里有 tracebook 行，但页面 404 | `dist/web/` 缺失 | 在仓库里 `npm run build:web`（或完整 `npm run build`） |
| 页面能打开但没有样式 / 控制台加载旧资源 | 构建产物陈旧 | `npm run build:web` 后强制刷新 |
| 会话标题栏没有 `Tracebook` 按钮 | `dist/client.js` 未生成，或改完 Client Plugin 没生效 | `npm run build:client` 后刷新页面（`client-hmr` 通常已推送新 bundle），仍不行再重启 `dsh web` |
| `dsh plugin` 报 `pnpm not found on PATH` | 目标机器没装 pnpm | 安装 pnpm 后重试 |
| 安装时 pnpm 报 `Issues with peer dependencies found` | 能力包由 DSH 自身安装提供，profile 里不重复装 | 可忽略：实测装完能正常启动，`/tracebook/api/cases` 返回 200 |
| 两个 profile 各有一份数据 | `artifactDirectory` 用了相对路径 | 在 `cordis.patch.yml` 里写绝对路径 |

### 不推荐：直接安装 git 源

```bash
dsh plugin --profile web add github:songxiyuan/tracebook
```

实测失败（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）：git 依赖必须现场跑 `prepare` 重建 `dist/`，而 pnpm 10+ 默认拦截依赖的构建脚本；`allowBuilds` 的键必须是带 commit 的完整解析串，每次 push 都会变，升级时还要重配一次。用方式 1 或方式 2。

## 配置

Bundle 默认插入一个 `tracebook` Host plugin。在 `~/.dsh/profiles/web/cordis.patch.yml` 里覆盖：

```yaml
- id: tracebook
  config:
    artifactDirectory: /absolute/path/to/tracebook-data/artifacts
    seedExampleCase: true
```

Patch 按行定位：没写的字段保持原值，但 `config` 是**整块替换**而不是深合并，所以要把这一行要用的键一起列出。这里只有 `id` + `config`，不存在 `update:` 之类的包裹键。

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| `artifactDirectory` | `.tracebook/artifacts`（相对工作目录） | Artifact 文件目录。**多机器 / GUI 场景建议改成绝对路径**，否则数据会跟着工作目录漂移 |
| `webDirectory` | `dist/index.js` 同级的 `dist/web/` | 自定义已构建 Viewer 目录，一般不用改 |
| `metadataOnlyArtifacts` | `false` | 仅保存 Artifact 元数据、不写 payload；主要用于受限部署和测试 |
| `seedExampleCase` | `false` | 启动时幂等写入一个覆盖 8 类 Block 与 5 类 Artifact 的完整 mock Case |

Storage backend 由 DSH `storage-domain` 路由决定，Tracebook 不直接依赖 SQLite。`seedExampleCase` 只在首次生效，重复启动是 no-op。

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

构建产物是 DSH Client Modules 期望的 lazy-CJS bundle，模块 id 即包名：

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

改动生效范围：

- **仅改 Vue Viewer**（`web/`）：`npm run build:web` 后刷新页面即可——Host 对 `/tracebook` 的静态资源按请求读盘。
- **改了 Client Plugin**（`src/client`）：`npm run build:client`。web profile 默认启用 `dsh-client-hmr`，它轮询每个 `dsh.client` bundle 的 mtime/size，变化时经 `/plugins/events` 推给浏览器热更新；刷新页面可兜底。
- **改了 Host Plugin**（`src/host`、`src/core`、`src/index.ts`）：**默认必须重启 `dsh web`**——宿主插件的主模块在启动时只 `import` 一次，`dist/index.js` 变了也不会重新加载。只刷新页面不够。

可选：打开宿主 HMR 免重启。web profile 的 base 层自带 `@deepseek-ai/cordis-plugin-hmr`，但默认 `disabled: true`。在 `~/.dsh/profiles/web/cordis.patch.yml` 里打开，并把监控根目录指到插件的构建产物：

```yaml
- id: hmr
  disabled: false
  config:
    root: ['.', /absolute/path/to/tracebook/dist]
    ignored: ['**/node_modules', '**/.*']
    debounce: 100
```

之后 `npm run build` 写出的新 `dist/index.js` 会在进程内热重载：HMR 顺着 Node 模块图清缓存，只重载依赖该文件的插件行；Agent 的工具列表每个 step 都从实时注册表重新组装，所以正在进行的会话下一步就能用上新的 Tool schema，不必新建会话。两点限制：patch 里的 `config` 是整块替换，必须重述 base 默认的 `root: ['.']`；框架级依赖的变化仍会退化成 `loader.exit()` 整进程重启。首次启用 HMR 这一步本身仍需要重启一次 `dsh web`。

完整架构与产品边界见 [设计方案](https://github.com/songxiyuan/tracebook/blob/main/doc/tracebook-dsh-plugin-design.md)，交互补齐的范围、落地位置与验收见 [交互补齐说明](https://github.com/songxiyuan/tracebook/blob/main/doc/tracebook-pending-interactions.md)。
