# Tracebook 安装与部署

> 状态：安装、bundle 注册与构建路径已在 DSH `0.1.5-rc.3` / Node `v26` 上逐条实测
> 适用对象：把 Tracebook 装到另一台电脑，或在本机重装
> 相关文档：[设计方案](tracebook-dsh-plugin-design.md) · [交互补齐说明](tracebook-pending-interactions.md)

本文只描述**验证过**的安装路径。曾经尝试但失败的做法记在第 4 节，避免重复踩坑。

---

## 0. 前置条件

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22 | 仓库 `engines` 要求 |
| DSH | `npm i -g @deepseek-ai/dsh` | 需提供 `dsh` 命令；`web` profile 首次使用会自动初始化 |
| pnpm | 随 `dsh plugin` 调用 | `dsh plugin` 是 pnpm 的薄转发器，用 PATH 上的 `pnpm`（实测 11.9.0） |
| 网络 | 方式 A 需要能访问 GitHub + npm registry；方式 B 只需 npm registry | 内网机器优先用方式 B |

Tracebook 不是 Agent Runtime：它作为 DSH bundle 装载，不引入第二套 runtime，也不修改 DSH Web。

---

## 1. 方式 A（推荐）：克隆 + link

目标机器上有构建环境时用这条。后续 `git pull` 即可升级。

```bash
git clone https://github.com/songxiyuan/tracebook.git
cd tracebook

# 安装依赖，并自动构建 dist/index.js、dist/client.js、dist/web/
npm ci

# 装进 web profile（用绝对路径）
dsh plugin --profile web add "$(pwd)"

# 启动
dsh web
```

然后打开 `http://127.0.0.1:<dsh-port>/tracebook/`，或点会话标题栏的 `Tracebook` 按钮。

### 为什么不能用 `--legacy-peer-deps`

DSH 能力包（`@deepseek-ai/cordis`、`dsh-host-webserver`、`dsh-storage-domain`、`dsh-tools`、`dsh-session` 等）对外声明为 **peerDependencies**，发布包运行时由宿主提供。但 link 安装会保留源码仓库的真实路径，Node 会优先使用该目录自己的 `node_modules`；若用 `--legacy-peer-deps` 跳过传递 peer，直接开发依赖会遮蔽宿主包，并在启动时出现 `ERR_MODULE_NOT_FOUND`。仓库 lockfile 因此固定了与 DSH `0.1.5-rc.3` 对齐的完整 peer graph，link 开发与构建统一使用 `npm ci`。

### `npm ci` 为什么就够了

`package.json` 里有 `"prepare": "npm run build"`。在包根目录执行 `npm ci` 时 npm 会自动运行它，也就是 `build:web → tsup → build:client`，产出：

```text
dist/index.js        宿主插件（含 HTTP 路由与三个 Agent Tool）
dist/client.js       DSH Client Plugin（标题栏按钮 + Sidebar tab + 追问桥）
dist/web/            Viewer 静态资源（Vue SPA）
```

`webDirectory` 默认解析到 `dist/index.js` 旁边的 `dist/web/`，所以三样齐全才能正常打开页面。想显式确认构建结果：

```bash
npm run verify      # typecheck + vitest + 完整构建
```

### `dsh plugin add` 做了什么

它是 `pnpm` 的转发器，因此接受包名、git 源、tarball、本地目录等 pnpm 支持的写法。本地目录会被锚定成 `link:` 依赖。命令结束时还会**把 `dsh.profile.bundles` 与被安装的依赖状态对齐**：凡是声明了 `dsh.bundle` 的依赖会自动加入层栈 —— Tracebook 满足该条件，所以**不需要手改 `package.json`**。

实测结果（临时 profile）：

```json
{
  "dependencies": { "dsh-tracebook": "link:/path/to/tracebook" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-tracebook"] } }
}
```

用 link 方式时依赖预先构建好的工作目录，因此**不会触发 pnpm 的构建脚本拦截**，一次成功。

---

## 2. 方式 B：`npm pack` 离线包

目标机器没有构建环境（或不想装 Node 开发依赖）时用这条。包内已含构建产物，约 640 KB。

```bash
# ① 有源码的机器：构建并打包
cd tracebook
npm ci
npm pack                      # → dsh-tracebook-0.1.0.tgz

# ② 拷贝到目标机器
scp dsh-tracebook-0.1.0.tgz user@other-machine:/tmp/

# ③ 目标机器：先初始化 profile（已存在时无副作用）
dsh plugin --profile web list

# ④ 目标机器：在 ~/.dsh/profiles/web/pnpm-workspace.yaml 里允许 vue-demi 的构建脚本
#    allowBuilds:
#      vue-demi: true

# ⑤ 目标机器：安装
dsh plugin --profile web add /tmp/dsh-tracebook-0.1.0.tgz
```

### 第 ④ 步为什么必需

pnpm 10 起默认拦截依赖的构建脚本（11.x 用 `allowBuilds` 白名单，报错码 `ERR_PNPM_IGNORED_BUILDS`）。Tracebook 的依赖树里有 `vue-demi`（`@vue-flow/*` 的传递依赖），它带 `postinstall`。被拦截时 pnpm 以非零码退出，而 `dsh plugin` 只在 pnpm 退出码为 0 时才对齐 `dsh.profile.bundles`：

```js
if (exitCode === 0) reconcilePlugins(before, dir)
else process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}`)
```

结果是**依赖装上了、bundle 却没注册**，`dsh web` 起来看不到 Tracebook。提前把 `allowBuilds` 设好即可一次成功（实测退出码 0 且 `dsh-tracebook` 自动进入 bundles）。

如果顺序反了：第一次 `add` 后 pnpm 会在 `pnpm-workspace.yaml` 里留下占位行

```yaml
allowBuilds:
  vue-demi: set this to true or false
```

把它就地改成 `vue-demi: true`（注意不要再追加第二个 `allowBuilds:` 键，YAML 会解析失败），然后重跑同一条 `add` 命令即可。

---

## 3. 验证安装

```bash
# 1) 组合后的 profile 树里应该有 tracebook 行
dsh --profile web --dump-config | grep -A3 tracebook

# 2) 启动后确认同源只读 API 与静态资源
dsh web
curl -s http://127.0.0.1:<port>/tracebook/api/cases

# 3) 页面入口
#    http://127.0.0.1:<port>/tracebook/
#    或会话标题栏的 Tracebook 按钮（经 Right Sidebar 打开，不可用时退化为同源新标签）
```

---

## 4. 不推荐：直接安装 git 源

```bash
dsh plugin --profile web add https://github.com/songxiyuan/tracebook.git
```

**实测失败**：

```text
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package
fetched from "git@github.com:songxiyuan/tracebook.git": The git-hosted package
"dsh-tracebook@0.1.0" needs to execute build scripts but is not in the
"allowBuilds" allowlist.
```

原因是 git 依赖必须靠 `prepare` 现场构建 `dist/`，而该脚本被 pnpm 拦截。`allowBuilds` 的键必须是**带 commit 的完整解析结果**：

```yaml
allowBuilds:
  dsh-tracebook@git+https://github.com/songxiyuan/tracebook.git#<40位commit>: true
```

`dsh-tracebook: true` 和去掉 commit 的键**都实测被拒绝**。也就是说这个键会随每次 push 变化，升级时还要重配一次。除非你明确需要这种形态，否则用方式 A 或 B。

---

## 5. 配置

Bundle 默认插入一个 `tracebook` 宿主插件。在 `~/.dsh/profiles/web/cordis.patch.yml` 里覆盖：

```yaml
- id: tracebook
  config:
    artifactDirectory: /absolute/path/to/tracebook-data/artifacts
    seedExampleCase: true
```

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| `artifactDirectory` | `.tracebook/artifacts`（相对工作目录） | Artifact 文件目录。**建议在多机器/GUI 场景改成绝对路径**，否则数据会跟着工作目录漂移 |
| `webDirectory` | `dist/index.js` 同级的 `dist/web/` | 自定义已构建 Viewer 目录，一般不用改 |
| `metadataOnlyArtifacts` | `false` | 只存 Artifact 元数据、不写 payload，用于受限部署与测试 |
| `seedExampleCase` | `false` | 启动时幂等写入一个覆盖 8 类 Block 与 5 类 Artifact 的示例 Case，用于开箱验证 |

Case 主数据走 DSH `storage-domain` 路由，Tracebook 不直接依赖 SQLite。`seedExampleCase` 只在首次生效，重复启动是 no-op。

---

## 6. 升级

| 安装方式 | 升级步骤 |
| --- | --- |
| 方式 A（link） | `git pull && npm ci` |
| 方式 B（tgz） | 重新 `npm pack`，`dsh plugin --profile web add <新 tgz>` |

改动生效范围：

- **仅改 Vue Viewer**（`web/`）：`npm run build:web`，刷新页面即可 —— Host 对 `/tracebook` 的静态资源按请求读盘。
- **改了 Client Plugin**（`src/client`）：`npm run build:client`。web profile 默认启用 `dsh-client-hmr`，它轮询每个 `dsh.client` bundle 的 mtime/size，变化时经 `/plugins/events` 推给浏览器热更新；刷新页面可兜底。
- **改了 Host Plugin**（`src/host`、`src/core`、`src/index.ts`）：**默认必须重启 `dsh web`** —— 宿主插件的主模块在启动时只 `import` 一次，`dist/index.js` 变了也不会重新加载。只刷新页面不够；若想免重启，见下面「可选：打开宿主 HMR」。

### 可选：打开宿主 HMR，免重启升级 Host Plugin

web profile 的 base 层自带 `@deepseek-ai/cordis-plugin-hmr`，但默认 `disabled: true`。在 `~/.dsh/profiles/web/cordis.patch.yml` 里打开它，并把监控根目录指到插件的构建产物：

```yaml
- id: hmr
  disabled: false
  config:
    root: ['.', /absolute/path/to/tracebook/dist]
    ignored: ['**/node_modules', '**/.*']
    debounce: 100
```

之后 `npm run build` 写出的新 `dist/index.js` 会在进程内热重载：HMR 顺着 Node 模块图清缓存，只重载依赖该文件的插件行；Agent 的工具列表每个 step 都从实时注册表重新组装，所以正在进行的会话下一步就能用上新的 Tool schema，不必新建会话。

两点限制：patch 里的 `config` 是整块替换，必须重述 base 默认的 `root: ['.']`；框架级依赖的变化仍会退化成 `loader.exit()` 整进程重启。首次启用 HMR 这一步本身仍需要重启一次 `dsh web`。

---

## 7. 卸载

```bash
dsh plugin --profile web remove dsh-tracebook
```

`dsh.profile.bundles` 里的条目会随依赖移除自动清理。Artifact 文件与 Case 数据不会被删除，需要时手动清理 `artifactDirectory` 与对应 storage。

---

## 8. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 启动时报 DSH peer 包 `ERR_MODULE_NOT_FOUND` | 使用了 `--legacy-peer-deps`，本地 link 的依赖树不完整 | 删除 `node_modules` 后运行 `npm ci` |
| `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` | git 源的 `prepare` 被拦截 | 改用方式 A / B；或按第 4 节填带 commit 的键 |
| `dsh: pnpm failed in profile directory …`，`dump-config` 里没有 tracebook | pnpm 因被拦截的构建脚本非零退出，bundle 未注册 | 按第 2 节第 ④ 步设置 `allowBuilds` → 重跑 `add` |
| `dump-config` 有 tracebook 行，但页面 404 | `dist/web/` 缺失 | 在仓库里 `npm run build:web`（或完整 `npm run build`） |
| 页面能开但没有样式 / 控制台报旧资源 | 构建产物陈旧 | `npm run build:web` 后强制刷新 |
| 会话标题栏没有 `Tracebook` 按钮 | `dist/client.js` 未生成，或改完 Client Plugin 没生效 | `npm run build:client` 后刷新页面（`client-hmr` 通常已推送新 bundle），仍不行再重启 `dsh web` |
| `dsh plugin` 报 `pnpm not found on PATH` | 目标机器没装 pnpm | 安装 pnpm 后重试 |
| 两个 profile 各有一份数据 | `artifactDirectory` 用了相对路径 | 在 `cordis.patch.yml` 里写绝对路径 |
