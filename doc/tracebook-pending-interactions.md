# Tracebook 未完成交互说明

> 目的：记录 MVP 已能展示 Case 之后，仍需补齐的用户交互。
> 当前临时入口：在 DSH 当前地址后追加 `/tracebook/`。

## 1. 范围与优先级

| 优先级 | 交互 | 当前状态 | 完成目标 |
| --- | --- | --- | --- |
| P0 | DSH 原生入口 | 只能手动打开 `/tracebook/` | 用户能从 DSH 会话页一键打开 Tracebook |
| P0 | 当前 Case 联动 | Viewer 不知道当前 DSH Session | 优先打开当前 Session 关联的 Case |
| P1 | Ask about this | Node/Evidence 只能查看 | 可携带选中上下文回到当前对话继续追问 |
| P1 | 更新提示 | Case 更新后需要手动刷新 | 页面提示新 revision，并允许刷新内容 |
| P2 | 历史与高级检索 | 仅有 Case 搜索和表格过滤 | 支持 Block 搜索、版本历史和 revision diff |

## 2. DSH 原生入口

### 入口位置

- 在 DSH 会话标题栏或右侧栏注册 `Tracebook` 按钮。
- 图标旁可显示当前 Case 状态；没有关联 Case 时不显示红点或错误态。

### 点击行为

```text
点击 Tracebook
  ├─ 当前 Session 有关联 Case → 右侧 Browser 打开 /tracebook/cases/:caseId
  └─ 没有关联 Case           → 右侧 Browser 打开 /tracebook/
```

如果右侧 Browser 不可用，则退化为新浏览器标签打开同源 URL。

### 状态

- 加载中：按钮显示短暂 loading，避免重复点击。
- 成功：复用已打开的 Tracebook Tab，不重复创建。
- 失败：提示“无法打开 Tracebook”，并提供“复制链接”。

### 验收

1. 用户不需要手动输入 `/tracebook/`。
2. 同一会话重复点击只激活已有 Tab。
3. 本地地址和 Tailscale/反向代理地址都使用当前页面 origin，不写死 `127.0.0.1`。

## 3. 当前 Case 联动

### 有关联 Case

入口直接打开 Case 详情；页面标题区域显示：

```text
当前会话关联 · Revision 3 · completed
```

### 无关联 Case

打开 Case 列表，并在顶部显示轻提示：

```text
当前会话尚未关联 Case。可让 Agent 调用 tracebook_open 创建或关联。
```

提供一键复制提示词：

```text
请调用 tracebook_open，为当前调查创建一个 Tracebook Case。
```

### 验收

1. 不要求用户手动复制 Case ID。
2. Session 与 Case 的关联来自既有 `sourceSessions`，不新增第二套业务写路径。
3. 一个 Session 关联多个 Case 时，先展示选择列表，不静默猜测。

## 4. Ask about this

### 触发位置

- Flow Node Inspector：`Ask about this`。
- Evidence 卡片：`Ask about this`。
- 后续可扩展到任意 Block 标题菜单。

### 交互流程

```text
选择 Node / Evidence
  → 点击 Ask about this
  → 输入问题（可留空）
  → 预览将发送的上下文
  → 插入当前 DSH Conversation 输入框
  → 用户确认发送
```

上下文至少包含：

```json
{
  "caseId": "ppt-f3ac54cc",
  "blockId": "backend-flow",
  "selection": { "type": "node", "id": "service" },
  "question": "这个服务后面还调用了谁？"
}
```

### 约束

- 默认只填入输入框，不自动发送，保留用户最终确认。
- 页面只组织上下文，不直接执行调查或根因分析。
- 写入结果仍由 Agent 通过 `tracebook_update` 完成。

### 验收

1. Agent 能识别 Case、Block 和具体选中项。
2. 追问完成后仍更新原 Case，而不是新建重复 Case。
3. 取消操作不修改对话或 Case。

## 5. 页面更新提示

### 交互

- Case 详情页定期检查 revision，或在页面重新获得焦点时检查。
- 发现服务端 revision 更高时显示非阻塞提示：

```text
Case 已更新到 Revision 4    [刷新内容]
```

- 用户点击后重新获取文档，并尽量保留当前滚动位置和选中的 Flow Node。

### 验收

1. 不在用户阅读时强制跳回顶部。
2. 网络失败只显示可重试提示，不清空当前内容。
3. 没有新 revision 时不产生干扰。

## 6. P2 后续项

- Block 标题与正文搜索。
- Artifact 按类型筛选和更丰富的内嵌预览。
- Revision 历史列表与两个 revision 的 Block diff。
- Flow layout 切换和 Flow diff。

这些能力不阻塞“从 DSH 打开 → 阅读 Case → 选择证据追问 → Agent 更新原 Case”的首个完整交互闭环。

