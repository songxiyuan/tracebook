# 决策记录：接口详情是否复用 OpenAPI 渲染器

- **日期**：2026-09-23
- **状态**：已决定 —— **不引入 OpenAPI 渲染器作为主路径**
- **适用范围**：Tracebook `api` Block 的接口详情展示（设计文档 7.8 节）
- **关联**：[端点上详情 UI 模式调研](api-endpoint-detail-ui-patterns.md)

## 结论

Tracebook 不为接口详情引入任何 OpenAPI 渲染器，`api` Block 自建。

如果将来确实需要渲染 Case 内**已经存在**的 OpenAPI 文档，选 **Scalar**，并且只能作为**懒加载的可选路径**（P3），不能成为读取接口详情的前提。

## 依据

### 1. 没有渲染器能表达"耗时"，OpenAPI 本身也不能

对 OAS 3.0.3 / 3.0.4 / 3.1.1 / 3.2.1 四份规范全文检索 `latency`、`response time`、`metric`、`percentile`、`histogram`、`throughput`、`monitoring`，**命中数均为 0**。OpenAPI 扩展注册表中也没有任何性能 / 流量 / SLA 扩展；`x-oai-*` 与 `x-oas-*` 由 OAI 保留，第三方不得占用。OAI issue #3063「Describe expected response times」未被采纳，社区提出的名字是 `x-expected-response-time-ms`。

八款渲染器中唯一与耗时沾边的只有 Swagger UI 的 `displayRequestDuration`，它度量的是"你在文档里点 Try-it 这一次"的本地往返，不是被调查接口的观测延迟。

这正是 `api` Block 把 `timing.source` 设成必填、并把声明耗时（`expectedMs`）与实测分开的原因。

### 2. 渲染器都要求一份合法 OpenAPI 文档，而调查场景常常没有

在 jsdom 中实际挂载运行三个渲染器，输入三份 spec：只有 `paths` 没有 `info`、无法解析的 `$ref`、以及一份合法对照。

| 渲染器 | 只有 paths、没有 info | 无法解析的 `$ref` | 控制台 |
| --- | --- | --- | --- |
| **Scalar** | 渲染成功 | 渲染成功 + 1 条警告 | 少 |
| **ReDoc** | 渲染错误页 + `TypeError: Cannot read properties of undefined` + 堆栈 | `Error: Invalid reference token: schemas` | 1 error |
| **RapiDoc** | 渲染成功 | 渲染成功但**零诊断**，schema 静默消失 | 无 |

**RapiDoc 的失败模式是静默丢数据。** 对一个以"如实展示现状"为目的的工具，坏 `$ref` 无声消失等同于丢证据——这比它停更更致命，构成对 RapiDoc 的否决。

ReDoc 的结论同样是否决：`redoc` 的库构建必须带 React（standalone 也内嵌 React），有一个**无法关闭**的 `cdn.redoc.ly` 请求，且在缺 `info` 的文档上稳定崩溃。另外它无条件 `new Worker(URL.createObjectURL(...))`，而该构造在自身的 try/catch **之外**，因此在缺少 `Worker` / `createObjectURL` 的环境（例如加固过的沙箱 iframe）会直接抛错。

### 3. 体积与离线成本（对已发布产物实测 gzip -9）

| 方案 | 形态 | 是否自带 React | gzip 体积 | 离线外部请求 |
| --- | --- | --- | --- | --- |
| **Scalar** | **Vue 3 组件** | 否 | **~1.21 MB**（standalone）/ ~1.13 MB（ESM 图） | 14 个 `@font-face` → `fonts.scalar.com`；localhost 下 AI Agent 默认开启会上传 spec |
| RapiDoc | Web Component (Lit) | 否 | ~212 KB | Google Open Sans（`load-fonts="false"` 可关） |
| openapi-explorer | Web Component (Lit) | 否 | ~217 KB | 无（离线最好） |
| ReDoc | React（standalone 内嵌） | **是** | ~319 KB | `cdn.redoc.ly` 图标，无法关闭 |
| Stoplight Elements | "Web Component" | **是（内嵌 React）** | ~598 KB + 289 KB CSS | 无 |
| Swagger UI | JS bundle | **是（内嵌 React + Redux）** | ~419 KB | `validator.swagger.io` 默认开启 |

所谓"vanilla JS bundle"并不等于没有 React：Stoplight Elements 与 Swagger UI 的发布产物里都能找到 React 内部标记。这与设计文档 §12.1「不推荐 React → Vue Bridge」直接冲突。

### 4. 若将来必须渲染 OpenAPI：选 Scalar，并遵守以下约束

选它的理由：唯一原生 Vue 3 组件；唯一提供**组件级 `x-*` 声明式渲染**（正是把观测耗时挂到 operation 上所需要的）；唯一能同时容忍缺 `info` 与坏 `$ref`。

必须同时满足：

- `withDefaultFonts: false`、`agent: { disabled: true }`、`showDeveloperTools: 'never'`、`telemetry: false`。
- 通过 `sources: [{ content, title }]` 传文档（实测文档里的顶层 `{ content }` 会被 standalone 构建忽略，只挂出主题外壳）。
- 懒加载，浏览器 CSP 需要允许 `style-src 'unsafe-inline'`。
- 不要用 `pluginUrls`（运行时远程 ESM 导入），只用 `plugins`。

RapiDoc 的补充陷阱（若仍要评估）：自定义元素是 **`<rapi-doc>`** 而不是 `<rapidoc>`，写错会注册成 `HTMLUnknownElement`，无输出、无报错；默认 `render-style="focused"`，主题跟随 `prefers-color-scheme`。

## 仍未验证

- Stoplight Elements 与 openapi-explorer 面对不完整文档的行为。
- RapiDoc schema 面板内部是否会画出坏 schema 的占位（jsdom 无法完成布局相关的验证）。
- Redoc 3.0 的 OpenTelemetry 是否默认开启。
- Fern / Mintlify 自托管容器内的运行时外部调用（Enterprise 门禁）。
- 体积数字来自对发布产物的实测；Bundlephobia 的数字一律只作参考。
