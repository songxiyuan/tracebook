# Viewer 能力补齐（viewer-capability-gaps）

## 背景

`doc/tracebook-optimization-plan.md` 的批次 A–D 已落地（见该文 §6）。剩余未优化项集中在 §3 P2 末尾的「Viewer 能力缺口」清单，以及 §2.4 的两个 Flow 增强。经对当前代码逐项核实（present/partial/absent），下列为**确实缺失或仅部分实现**、且价值高、可独立交付的项。

## 现状核实（关键结论）

- 页面标题/404：**缺失**。`router.ts` catch-all 直接 redirect，无 404 页；无 `document.title` 逻辑。
- CaseList 过滤/排序：**缺失**。仅有全文子串过滤（`CaseList.vue`），无按 status/type/environment 过滤、无列排序。
- 导出（Markdown/JSON/打印）：**缺失**。
- 分享深链 / copy-as-cURL：**缺失**。
- Artifact 下载/复制按钮：**缺失**（仅有 `Open raw ↗` 新标签链接）。
- 深色主题：**缺失**（`styles.css` 锁 `color-scheme: light`）。
- 键盘快捷键 + 帮助浮层：**缺失**。
- 无障碍：Ask 弹窗有 dialog 语义但**无 focus-trap**；搜索框**无可访问名**；Flow 节点**不可键盘操作**。
- 按 revision 的客户端缓存：**缺失**（每次 fresh fetch）。
- 图片 lightbox：**已实现**（ArtifactPanel）——不再处理。
- 请求 timeout/abort、list 重试：**已实现**——不再处理。

## 目标与范围（本轮）

按"最优最长远、可独立回退"实施，每项一个 commit：

1. 动态页面标题 + 真正的 404 页（router meta + 标题守卫 + NotFound 视图）。
2. CaseList：列排序（标题/更新时间/revision）+ status/type/environment 过滤。
3. Case 导出：JSON 下载 + Markdown 下载 + 打印样式。
4. 分享与复制：块级深链复制、API endpoint 的 copy-as-cURL、artifact 的复制链接。
5. Artifact 下载按钮（`download` 属性）。
6. 无障碍：Ask 弹窗 focus-trap、搜索框 `aria-label`、Flow 节点可 Tab 聚焦 + Enter 选中。
7. 键盘快捷键 + 帮助浮层（`/` 聚焦搜索、`?` 帮助、`g h` 回列表、`Esc` 关闭）。
8. 按 revision 的客户端缓存（`api.ts` 读缓存 + CaseDetail 命中）。
9. 深色主题：`styles.css` 令牌化 + `[data-theme]` 覆盖 + 顶栏切换（持久化 + `prefers-color-scheme`），并把组件内硬编码色改为变量。

## 不在本轮范围（明确记录）

- Revision **revert/restore**：属写路径，涉及数据变更与新 host 端点，风险与体量较大，另行评审。
- 跨案例**后端全文搜索**：需新增服务端检索能力，超出 Viewer 范畴。
- Flow **双击折叠子树 / ELK 泳道 wrapping**：交互与布局复杂度高，作为后续增强（本轮先补键盘可达性）。
- 跨进程实时可见（P0-1 剩余部分）：依赖 storage-domain 缺 reload 原语，无法在当前依赖解决。

## 架构与约束

- 遵守 AGENTS.md：不新增等价写路径；Vue 页面走同源 HTTP API；Flow 保持 Vue Flow 渲染 / ELK 布局；不侵入 DSH Web。
- 全部为 Viewer（`web/src/**`）纯前端改动，不改协议与存储；导出/复制均在客户端完成。
- 每个 commit 自包含、互不依赖，便于选择性回退。

## 影响文件（预估）

- `web/src/router.ts`、`web/src/App.vue`、新增 `web/src/pages/NotFound.vue`
- `web/src/pages/CaseList.vue`、`web/src/pages/CaseDetail.vue`
- `web/src/components/ArtifactPanel.vue`、`web/src/components/blocks/{FlowBlock,ApiBlock}.vue`
- 新增 `web/src/export.ts`（Markdown/JSON 组装）、`web/src/clipboard.ts`（复制/cURL 辅助）、`web/src/theme.ts`（主题状态）、`web/src/shortcuts.ts`（快捷键）
- `web/src/api.ts`（revision 缓存）、`web/src/styles.css`（深色主题令牌）

## 验证

每个 commit 前运行 `npm run typecheck`；全部完成后 `npm run build` + `npx vitest run` 必须全绿。
