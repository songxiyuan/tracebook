# Tracebook 交互补齐说明

> 目的：记录 MVP 已能展示 Case 之后补齐的用户交互，以及每项的落地位置与验收方式。
> 当前入口：DSH 会话标题栏的 `Tracebook` 按钮；也可直接访问 `http://<dsh-host>/tracebook/`。

## 0. 完成状态

| 优先级 | 交互 | 状态 | 落地位置 |
| --- | --- | --- | --- |
| P0 | DSH 原生入口 | 已完成 | `src/client/TracebookAction.tsx`、`src/client/index.tsx` |
| P0 | 当前 Case 联动 | 已完成 | `src/client/TracebookTab.tsx`、`web/src/session.ts`、`web/src/pages/CaseList.vue`、`web/src/pages/CaseDetail.vue` |
| P1 | Ask about this | 已完成 | `web/src/components/blocks/FlowBlock.vue`、`EvidenceBlock.vue`、`CaseDetail.vue`、`src/client/bridge.ts` |
| P1 | 更新提示 | 已完成 | `web/src/pages/CaseDetail.vue`、`src/host/http.ts` |
| P2 | Block 搜索 | 已完成 | `web/src/pages/CaseDetail.vue` |
| P2 | Artifact 类型筛选与内嵌预览 | 已完成 | `web/src/components/ArtifactPanel.vue`、`web/src/artifact-kind.ts` |
| P2 | Flow Node Artifact 缩略图 | 已完成 | `web/src/components/blocks/FlowBlock.vue`、`web/src/artifact-kind.ts` |
| P2 | Revision 历史与 Block diff | 已完成 | `src/core/model.ts`、`src/host/storage.ts`、`web/src/components/RevisionHistory.vue` |
| P2 | Flow layout 切换与 Flow diff | 已完成 | `web/src/components/blocks/FlowBlock.vue`、`RevisionHistory.vue` |

设计边界没有变化：Tracebook 只组织与展示上下文，不执行调查、不判断根因；Case 的写入仍然只由 Agent 的 `tracebook_open` / `tracebook_update` 完成。

---

## 1. DSH 原生入口

### 入口位置

- 在会话标题栏的动作位（`conversation.session.header.actions`）注册 `Tracebook` 按钮，实现在 `src/client/TracebookAction.tsx`。
- 按钮通过 `GET /tracebook/api/sessions/:sessionId/cases` 读取当前会话的关联 Case；有关联时在按钮上显示一个绿色状态点，没有关联时不显示红点或错误态。
- 这是 DSH 薄 Client Plugin，不嵌入 Vue：它只负责打开 URL 与回填文本。

### 点击行为

```text
点击 Tracebook
  ├─ 右侧栏可用 → ctx.sidebarRight.openTab('tracebook')，标签内嵌 /tracebook/?session=<sessionId>
  └─ 右侧栏不可用 → window.open(/tracebook/?session=<sessionId>, '_blank')
```

- 打开地址使用相对路径，始终复用当前页面的 origin，因此 loopback、Tailscale 与反向代理地址都不需要额外配置。
- 页面内部的 Case 归属由 Viewer 自己解析（见第 2 节），按钮不复制一份业务判断。

### 状态

- 加载中：按钮短暂禁用，避免重复点击。
- 成功：`openTab` 对 page 类型按 pane 去重，重复点击只聚焦已有 Tracebook 标签。
- 失败：按钮下方显示“无法打开 Tracebook”，并提供“复制链接”（相对 URL 会被补全为当前 origin 的绝对地址）。

### 验收

1. 用户不需要手动输入 `/tracebook/`。
2. 同一会话重复点击只激活已有标签（`openTab` 的 page 去重语义）。
3. 地址来自当前页面 origin，未写死 `127.0.0.1`。

---

## 2. 当前 Case 联动

### 有关联 Case

`/tracebook/?session=<sessionId>` 由 `web/src/pages/CaseList.vue` 处理：

- 有 active Case，或只有一个关联 Case → 直接跳转 `/tracebook/cases/:caseId?session=<sessionId>`。
- 关联多个 Case 且没有 active → 顶部展示“当前会话关联 N 个 Case”的选择列表，不静默猜测。
- Case 详情页标题区显示：

```text
当前会话关联 · Revision 3 · completed
```

### 无关联 Case

- 打开 Case 列表，并在顶部显示轻提示：`当前会话尚未关联 Case。可让 Agent 调用 tracebook_open 创建或关联。`
- 提供一键复制提示词：`请调用 tracebook_open，为当前调查创建一个 Tracebook Case。`
- 详情页在看到“当前会话关联的是别的 Case”时，给出跳转到 active Case 的链接。

### 数据来源

- 关联来自既有 `sourceSessions`，active Case 来自既有 `session_links` 行，没有新增第二套业务写路径。
- 新增只读 API：`GET /tracebook/api/sessions/:sessionId/cases`，返回 `{ sessionId, activeCaseId?, cases }`，其中 `cases` 只包含 `sourceSessions` 命中的 Case 摘要。

### 验收

1. 不要求用户手动复制 Case ID。
2. Session 与 Case 的关联完全来自既有 `sourceSessions`。
3. 一个 Session 关联多个 Case 时先展示选择列表。

---

## 3. Ask about this

### 触发位置

- Flow Node Inspector：`Ask about this`。
- Evidence 卡片：`Ask about this`。
- 其他 Block 复用同一套 `BlockRenderer` 事件转发，后续可扩展到任意 Block 标题菜单。

### 交互流程

```text
选择 Node / Evidence
  → 点击 Ask about this
  → 输入问题（可留空）
  → 预览将发送的上下文
  → 插入当前 DSH Conversation 输入框（追加到已有草稿之后）
  → 用户确认发送
```

上下文至少包含：

```json
{
  "caseId": "ppt-f3ac54cc",
  "caseTitle": "PPT 生成功能",
  "revision": 3,
  "blockId": "backend-flow",
  "selection": { "type": "node", "id": "slide-service", "label": "slide-service" },
  "question": "这个服务后面还调用了谁？"
}
```

发送的文本还包含一段固定约束：`请继续调查后调用 tracebook_update 更新同一个 Case（caseId=…，blockId=…），不要新建重复 Case。`

### 桥接方式

- Viewer 通过 `postMessage`（同源校验）把 `{ source: 'tracebook', type: 'ask', sessionId, envelope, text }` 交给 DSH Client Plugin。
- `src/client/bridge.ts` 使用 `ctx.sessions.scope(sessionId)` 解析会话作用域，再通过 `ctx.conversation.input.for(actx)` 读取当前草稿并 `setDraft` 追加，不覆盖用户已有内容。
- Client Plugin 回传 `{ type: 'ask-result', ok, reason? }`；Viewer 只在收到成功确认后才提示“已插入”，失败或 3 秒无响应时提示改用“复制上下文”。
- 未嵌入 DSH（独立浏览器标签）时，Viewer 直接复制追问上下文到剪贴板。

### 约束

- 默认只填入输入框，不自动发送，保留用户最终确认。
- 页面只组织上下文，不直接执行调查或根因分析。
- 写入结果仍由 Agent 通过 `tracebook_update` 完成。

### 验收

1. Agent 能识别 Case、Block 和具体选中项（结构化 envelope 直接进入输入框）。
2. 追问完成后仍更新原 Case（提示词显式约束 `caseId` 与 `blockId`）。
3. 取消操作不修改对话或 Case（只有点击提交才写入草稿）。

---

## 4. Flow Node Artifact 缩略图

### 交互

- Flow Node Inspector 的 `Artifacts` 区把节点 `artifactRefs` 对着 Case 的 artifacts 解析：图片类 Artifact（`mimeType` 以 `image/` 开头，或 `kind` 为 `screenshot` / `image` / `png`）直接内嵌缩略图，点击缩略图在新标签页打开原图。
- 非图片 Artifact 仍然只渲染原始链接；Artifact 无法加载（引用不存在、或部署开启了 `metadataOnlyArtifacts` 没有 payload）时回退为链接，不显示破图。
- 协议没有变化：`artifactRefs` 本来就是 `flowNodeSchema` 的字段，Agent 不需要写新字段，也不需要新的 Tool。

### 实现位置

- `web/src/components/blocks/FlowBlock.vue`：解析引用、按需渲染缩略图与失败回退。
- `web/src/artifact-kind.ts`：`isImageArtifact`，与 `ArtifactPanel` 共用同一套图片判定。
- `web/src/styles.css`：`.inspector-shot`。

### 验收

1. 节点带截图 `artifactRefs` 时，Inspector 内直接看到缩略图，无需离开页面。
2. 引用非图片或加载失败时退化为原始链接，Inspector 不出现破图。
3. 未修改 Block Schema、Tool 与 HTTP API；Artifact 面板行为不变。

---

## 5. 页面更新提示

### 交互

- Case 详情页每 12 秒轮询一次 `GET /tracebook/api/cases/:id/revision`，并在窗口重新获得焦点、页面重新可见时立即检查。
- 服务端 revision 更高时显示非阻塞提示：

```text
Case 已更新到 Revision 4    [刷新内容]
```

- 点击后重新获取文档，并恢复刷新前的滚动位置与 Flow Node 选中项（`web/src/selection.ts` 记录阅读位置）。

### 验收

1. 不在用户阅读时强制跳回顶部（刷新后恢复滚动偏移）。
2. 网络失败只显示可重试提示，不清空当前内容。
3. 没有新 revision 时不产生干扰（不渲染任何提示）。

---

## 6. P2 后续项

- **Block 标题与正文搜索**：详情页 Outline 中的搜索框按 Block 标题、描述与正文内容过滤，并给出匹配结果；命中为空时提供清空入口。
- **Artifact 类型筛选与内嵌预览**：`ArtifactPanel` 按 `kind` 统计与筛选；图片内嵌展示，文本/JSON/日志/HTTP/Trace 折叠展开为 `pre` 预览，其余类型提供原始文件链接。
- **Revision 历史与 Block diff**：每次写入 Case 都会把该 revision 的标题、summary、status 与 blocks 快照写入 `revisions` 表；详情页可选择任意两个 revision 做按稳定 `block.id` 的 added / removed / changed 对比，并列出变化的字段或数组长度。
- **Flow layout 切换与 Flow diff**：Flow 块支持 `TB / LR / BT / RL` 切换（按 block 记住选择）；Flow 的变更通过 Block diff 中的 `nodes`/`edges` 长度变化呈现。

这些能力不阻塞“从 DSH 打开 → 阅读 Case → 选择发现追问 → Agent 更新原 Case”的完整闭环，闭环现已可用。

---

## 7. 只读 API 增量

```text
GET /tracebook/api/sessions/:sessionId/cases
GET /tracebook/api/cases/:id/revision
GET /tracebook/api/cases/:id/revisions
GET /tracebook/api/cases/:id/revisions/:revision
```

仍然是只读接口；唯一业务写入口依然是 Agent Tool。

---

## 8. 验证

```bash
npm run typecheck   # Vue + Client Plugin + Host 三层类型检查
npm test            # Core 与 Artifact Store 测试，含 session 联动与 revision 历史
npm run build       # Vue 构建 + Host 打包 + Client bundle
```

Client bundle 产出 `dist/client.js`，格式为 DSH Client Modules 期望的 `window.__ModuleLoader__.load({ id, factory })`；`package.json` 通过 `exports["./client"]` 与 `dsh.client` 声明，宿主在启动时按 profile 扫描加载。修改 Host 或 Client Plugin 后需要重启 `dsh web`，仅刷新页面不够。
