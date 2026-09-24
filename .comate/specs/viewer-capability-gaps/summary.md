# Viewer 能力补齐总结（2026-09-25）

## 任务

用户要求：确认 archify 流程图工作完成后，检查 `doc/tracebook-optimization-plan.md` 中尚未优化的内容，按"最优最长远"的方式自主补齐，并多次提交以便选择性回退。

## 核实方法

先用 Explore 子代理对当前 `web/src/**`、`src/**` 逐项核实优化计划里「Viewer 能力缺口」清单的 present/partial/absent，避免照着愿望清单重复劳动。已实现的（图片 lightbox、请求 timeout/abort、list 重试、CaseList 空态、Ask 弹窗 dialog 语义）不再处理。

## 已完成（每项一个 commit，可独立回退）

1. `243dc87` 动态页面标题 + 真正的 404 页
2. `9cc1ff0` 案例列表按状态/类型/环境筛选 + 列排序
3. `ff6f333` Case 导出 JSON/Markdown + 打印样式
4. `b706684` 块级深链、API copy-as-cURL、artifact 下载与复制直链
5. `8f15c5e` 无障碍：Ask 弹窗焦点陷阱、搜索框可访问名、Flow 节点键盘可达
6. `917ee89` 全局键盘快捷键 + 帮助浮层
7. `2ad9198` 按 (caseId,revision) 缓存不可变 revision 快照
8. `76ded8d` 深色主题（令牌覆盖 + 顶栏切换 + 组件配色令牌化）

（另有 `3f90fcc` 提交上一轮 archify spec 的清单/总结。）

## 新增/修改文件

- 新增：`web/src/pages/NotFound.vue`、`web/src/export.ts`、`web/src/clipboard.ts`、`web/src/shortcuts.ts`、`web/src/theme.ts`
- 修改：`web/src/router.ts`、`main.ts`、`App.vue`、`pages/CaseList.vue`、`pages/CaseDetail.vue`、`components/ArtifactPanel.vue`、`components/blocks/{BlockRenderer,ApiBlock,SequenceBlock,FlowBlock}.vue`、`api.ts`、`styles.css`

## 设计要点

- 全部为 Viewer 纯前端改动，未触协议、存储与写路径；导出/复制/cURL 均在客户端完成，符合 AGENTS.md（不新增等价写路径、不侵入 DSH Web、Flow 保持 Vue Flow 渲染 / ELK 布局）。
- 深色主题走"仅令牌覆盖"路线：`styles.css` 早已高度令牌化，只需 `[data-theme=dark]` 覆盖 `:root` 变量；额外把 SequenceBlock 硬编码色与 Flow 画布 chrome（dot grid / minimap，属 SVG 属性无法继承 CSS 变量）改为跟随主题。
- revision 快照按 `(caseId, revision)` 不可变缓存，是安全且明确正确的优化点（历史对比反复切换即时命中）。

## 有意不做（已在计划文档 §7 记录）

- Revision revert/restore（写路径，需新 host 端点，风险较大）
- 跨案例后端全文搜索（需服务端检索能力）
- Flow 双击折叠子树 / ELK 泳道 wrapping（本轮先补键盘可达性）
- 跨进程实时可见（受限于 storage-domain 缺 reload 原语）

## 验证

`npm run typecheck`（web/client/core）、`npm run build`、`npx vitest run`（73 passed）均全绿。
