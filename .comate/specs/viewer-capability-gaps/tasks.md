# Viewer 能力补齐任务计划

- [x] Task 1: 动态页面标题 + 404 页
    - 1.1: router 增加 NotFound 路由（不再直接 redirect）与路由 meta.title
    - 1.2: 新增 web/src/pages/NotFound.vue
    - 1.3: App.vue 或 router afterEach 根据路由/ Case 标题设置 document.title
    - 1.4: commit

- [x] Task 2: CaseList 排序 + 过滤
    - 2.1: 新增 status/type/environment 过滤控件与状态
    - 2.2: 列排序（标题/更新时间/revision，升降序）
    - 2.3: 与现有全文过滤组合；空态文案兼容
    - 2.4: commit

- [x] Task 3: Case 导出（JSON/Markdown/打印）
    - 3.1: 新增 web/src/export.ts：CaseDocument → Markdown、→ JSON Blob 下载
    - 3.2: CaseDetail 增加导出按钮（JSON/Markdown）
    - 3.3: 打印样式（@media print）隐藏工具栏、展开内容
    - 3.4: commit

- [x] Task 4: 分享深链 + copy-as-cURL
    - 4.1: 新增 web/src/clipboard.ts：copyText、buildCurl 辅助
    - 4.2: 块级复制锚点链接（BlockRenderer 块头）
    - 4.3: ApiBlock endpoint 的 copy-as-cURL；artifact 复制链接
    - 4.4: commit

- [x] Task 5: Artifact 下载按钮
    - 5.1: ArtifactPanel 增加下载按钮（download 属性 + 文件名）
    - 5.2: commit（与 Task 4 合并提交）

- [ ] Task 6: 无障碍补齐
    - 6.1: Ask 弹窗 focus-trap（Tab 循环）
    - 6.2: 搜索框 aria-label（CaseList/CaseDetail/FlowBlock）
    - 6.3: Flow 节点可 Tab 聚焦 + Enter/Space 选中
    - 6.4: commit

- [ ] Task 7: 键盘快捷键 + 帮助浮层
    - 7.1: 新增 web/src/shortcuts.ts（全局 keydown 注册/注销）
    - 7.2: `/` 聚焦搜索、`g h` 回列表、`?` 打开帮助、`Esc` 关闭
    - 7.3: 帮助浮层组件（dialog 语义）
    - 7.4: commit

- [ ] Task 8: 按 revision 的客户端缓存
    - 8.1: api.ts 增加以 caseId+revision 为键的读缓存（getCase/snapshot）
    - 8.2: CaseDetail/RevisionHistory 命中缓存，SSE/probe 变化时失效
    - 8.3: commit

- [ ] Task 9: 深色主题
    - 9.1: styles.css 定义 [data-theme=dark] 令牌覆盖 + prefers-color-scheme 默认
    - 9.2: 新增 web/src/theme.ts + 顶栏切换按钮（持久化）
    - 9.3: 组件内硬编码色改为变量（SequenceBlock/FlowBlock/ArtifactPanel 等）
    - 9.4: commit

- [ ] Task 10: 收尾验证与文档
    - 10.1: npm run typecheck / build / vitest 全绿
    - 10.2: 更新 doc/tracebook-optimization-plan.md 的进度小节
    - 10.3: 生成 summary.md
