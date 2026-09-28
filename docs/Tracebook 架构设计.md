# Tracebook 最终架构设计

> 状态：当前架构基线  
> 形态：DSH Plugin + 可独立演进的 Tracebook Core  
> 核心目标：沉淀 Agent 对真实业务系统的探索结果，并让未来 Agent 能够按需、可追溯地继续探索。

---

# 1. 项目定位

Tracebook 不是传统文档知识库，也不是代码搜索、日志平台或知识图谱产品。

它解决的是：

> Agent 在一次业务探索中获取了页面、HTTP、代码、日志、Trace、数据库等大量信息，这些信息如何形成可复用的业务认知，并让未来的新 Session / Agent 不需要重新从零调查。

核心流程：

```text
真实业务世界
    ↓
Agent Exploration
    ↓
Evidence
    ↓
Entity / Relation / Fact
    ↓
Tracebook
    ↓
未来 Agent 渐进式查询
    ↓
继续调查 / 验证 / 更新
```

Tracebook 最核心的价值是：

```text
探索
→ 沉淀
→ 复用
→ 验证
→ 更新
```

---

# 2. Tracebook 不做什么

项目边界必须保持克制。

Tracebook 不负责重新实现：

```text
代码搜索引擎
完整 Code Graph
日志平台
Trace / APM
Metric 平台
数据库管理系统
向量数据库
复杂 Graph DB
Service Catalog
```

优先复用已有基础设施：

```text
Git / Sourcegraph / SCIP
OpenTelemetry
现有日志平台 / Elasticsearch
数据库
内部服务目录 / Backstage 类系统
Browser / Playwright
```

Tracebook 保存的是：

> 这些系统之间形成的业务认知、探索记录和 Evidence 引用。

---

# 3. 总体架构

```text
                         DSH Main Agent
                               │
                               ▼
                       Tracebook Plugin
                  ┌────────────┴────────────┐
                  │                         │
              Agent Tools                   UI
                  │                         │
                  └────────────┬────────────┘
                               │
                         Tracebook API
                               │
                               ▼
                    ┌────────────────────┐
                    │   Tracebook Core   │
                    │                    │
                    │ Entity             │
                    │ Relation           │
                    │ Fact               │
                    │ Evidence           │
                    │ Artifact           │
                    │ Exploration        │
                    │ Search             │
                    └─────────┬──────────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
        PostgreSQL       Object Storage     Search Index
                                                  │
                                                  │
       ┌──────────────────────────────────────────┼───────────┐
       ▼                   ▼                      ▼           ▼
 Sourcegraph / Git    OpenTelemetry            Logs          DB
       │                   │                      │           │
       └───────────────────┴──────────┬───────────┴───────────┘
                                     │
                                  Browser
```

---

# 4. DSH Plugin 与 Tracebook Core 的关系

## 4.1 当前阶段

MVP 可以直接把 Tracebook Core 跑在 DSH Host 中：

```text
DSH Host

├── Tracebook Service
├── PostgreSQL
├── Artifact Service
├── Search
└── Remote API
```

这样开发成本最低。

---

## 4.2 长期边界

Tracebook Core 不应该永久依赖 DSH。

因为未来可能还有：

```text
DSH
CI
告警系统
离线 Worker
测试平台
其他 Agent
内部运维平台
```

共同读写 Tracebook。

因此一开始就定义稳定接口：

```text
Tracebook API
```

第一阶段：

```text
Tracebook API
    ↓
Local Host Implementation
```

以后可以变成：

```text
Tracebook API
    ↓
HTTP / RPC
    ↓
Standalone Tracebook Server
```

DSH Plugin 保持：

```text
UI
Agent Tools
Session Integration
```

而核心数据和业务能力独立演进。

---

# 5. 核心数据模型

Tracebook 保持六个核心对象：

```text
Entity
Relation
Fact
Evidence
Artifact
Exploration
```

可以分成三层：

```text
             Exploration
                  │
            一次完整调查
                  │
                  ▼
        Entity / Relation / Fact
                  │
               Knowledge
                  │
                  ▼
               Evidence
                  │
                Proof
                  │
                  ▼
               Artifact
               Raw Data
```

---

# 6. Entity

Entity 表示业务世界中的对象。

典型类型：

```text
Feature
Page
API
Service
Repository
CodeSymbol
Database
DatabaseTable
Redis
KafkaTopic
Job
Config
ExternalService
```

统一模型：

```json
{
  "id": "service:ppt-service",
  "type": "service",
  "name": "ppt-service",
  "summary": "负责 AI PPT 任务流程编排",
  "attributes": {}
}
```

不需要为每种 Entity 建独立复杂表。

特殊字段放：

```text
attributes JSONB
```

---

# 7. Relation

Relation 表示 Entity 之间的业务关系。

例如：

```text
Page USES_API API

API HANDLED_BY Service

Service CALLS Service

Service READS DatabaseTable

Service WRITES DatabaseTable

Service PRODUCES KafkaTopic

Service CONSUMES KafkaTopic

CodeSymbol IMPLEMENTS API
```

例如：

```json
{
  "id": "relation:ppt-netdisk",
  "source": "service:ppt-service",
  "type": "CALLS",
  "target": "service:netdisk-service",
  "summary": "PPT 生成完成后调用 netdisk-service 保存文件",
  "confidence": 0.99
}
```

长期来看，业务地图主要就是：

```text
Entity
  ↓
Relation
  ↓
Entity
```

---

# 8. Fact

Fact 是挂在 Entity 或 Relation 上的具体事实。

例如：

```text
/ppt/create 是异步接口

ppt-service 不执行实际 PPT 渲染

只有任务进入 generated 状态后才触发文件保存
```

例如：

```json
{
  "id": "fact:ppt-create-async",
  "subject": "api:ppt-create",
  "predicate": "execution_mode",
  "value": "async",
  "summary": "创建任务后立即返回 task_id"
}
```

Fact 不应该独立漂浮。

必须存在：

```text
subject
```

指向 Entity 或 Relation。

---

# 9. Evidence

Evidence 表示：

> 为什么某个 Entity / Relation / Fact 值得相信。

来源包括：

```text
HTTP
Code
Log
Trace
Database Query
Screenshot
Browser Observation
Metric
```

Evidence 保存的是可消费的关键证据：

```json
{
  "id": "evidence:log:001",
  "type": "log",
  "summary": "ppt-service 调用了 netdisk-service",
  "excerpt": "calling netdisk-service...",
  "source": {
    "service": "ppt-service",
    "trace_id": "abc"
  },
  "artifact_id": "artifact:log:001"
}
```

Evidence 不等于完整原始内容。

---

# 10. Artifact

Artifact 保存真正的大体积原始材料，例如：

```text
Screenshot
HAR
完整 HTTP Response
日志文件
SQL Result
报告
代码分析产物
```

例如：

```text
artifact://exp-001/page.png
artifact://exp-001/http.json
artifact://exp-001/log.txt
```

Artifact 通常放：

```text
File System
MinIO
S3
```

数据库保存 URI 和 Metadata。

---

# 11. Exploration

Exploration 是整个 Tracebook 中非常重要的对象。

它表示：

> Agent 为某一个目标进行的一次完整调查。

例如：

```text
探索 AI PPT 从点击生成到保存网盘的完整流程。
```

过程中：

```text
访问页面
↓
执行操作
↓
捕获 HTTP
↓
查看 Trace
↓
查询日志
↓
分析代码
↓
查询 DB
```

最终：

```text
Exploration

├── Goal
├── Summary
├── Findings
├── Entity
├── Relation
├── Fact
├── Evidence
└── Artifact
```

Exploration 本质上是：

> 过去 Agent 已经完成的一次调查包。

未来 Agent 应优先复用，而不是重新探索。

---

# 12. 知识可信度

不能把所有 Agent 结论都当成事实。

至少区分：

```text
OBSERVED
DERIVED
INFERRED
```

## OBSERVED

真实运行过程中直接观察：

```text
HTTP
Trace
Log
DB Result
Browser
```

---

## DERIVED

程序分析得到：

```text
AST
Code Call Graph
Configuration Analysis
```

---

## INFERRED

Agent 根据多个信息推断：

```text
“这里可能是为了避免 fsid 更新导致缓存失效。”
```

Knowledge 可以携带：

```text
knowledge_type
confidence
evidence_ids
last_verified
```

重要原则：

> Agent 推测不能无条件升级成永久事实。

---

# 13. 代码、HTTP、页面、日志如何自动关联

这是 Tracebook 最关键的能力之一。

关联策略必须遵循：

```text
硬关联
   ↓
静态分析
   ↓
Metadata
   ↓
启发式关联
   ↓
LLM 推断
```

越往后可信度越低。

---

# 14. Browser → Page → HTTP

每次 Exploration：

```text
exploration_id
```

每一个 Browser Action：

```text
step_id
```

例如：

```text
step_17

用户点击：
生成 PPT
```

同时监听 Network：

```text
step_17

├── POST /ppt/create
├── GET /ppt/status
└── screenshot.png
```

从而直接建立：

```text
Page
 ↓
BrowserStep
 ↓
HTTP Request
```

这部分是确定性关系。

---

# 15. HTTP → Trace → Service

优先依赖 OpenTelemetry。

例如 HTTP Header：

```text
traceparent
```

对应：

```text
HTTP Request
     ↓
Trace
     ↓
Span
     ↓
service.name=ppt-service
```

得到：

```text
POST /ppt/create
       ↓
HANDLED_BY
       ↓
ppt-service
```

不需要 LLM 猜测。

---

# 16. Trace → Log

如果日志包含：

```text
trace_id
span_id
service.name
```

可以直接关联：

```text
Trace
 ↓
Span
 ├── Log
 ├── Log
 └── Log
```

运行时关系尽量使用真实 Trace 建立。

---

# 17. Service → Repository

维护稳定映射：

```text
ppt-service
    ↓
repo:ppt-backend
```

来源可以是：

```text
部署配置
CI
Service Catalog
配置文件
人工确认
```

---

# 18. API → CodeSymbol

通过：

```text
Router
Framework Metadata
AST
```

获得：

```text
POST /ppt/create
        ↓
PPTController.Create
```

然后代码关系：

```text
PPTController.Create
        ↓
PPTService.Create
        ↓
NetdiskClient.Save
```

优先依赖：

```text
Sourcegraph
SCIP
现有代码搜索平台
```

Tracebook 不自行建设完整 Code Graph。

---

# 19. 最终跨源业务链路

理想情况下，一次 Exploration 最终可以形成：

```text
Exploration
     ↓
Page
     ↓
Browser Step
     ↓
HTTP Request
     ↓
Trace
     ↓
Service
 ┌───┴────┐
 ↓        ↓
Log      Repository
           ↓
       CodeSymbol
           ↓
      Downstream Call
           ↓
        Service
           ↓
          DB
```

这些关系中的大部分应该来自确定性数据。

LLM 主要负责：

```text
语义理解
业务总结
缺失关系推断
异常分析
```

而不是承担全部关联工作。

---

# 20. Progressive Disclosure

Tracebook 最大规模可能达到：

```text
大量 Entity
大量 Relation
大量 Exploration
百万级 Evidence
```

所以：

```text
Tracebook != Prompt
```

任何时候都不应该全量注入 Agent。

采用渐进式披露：

```text
L0 Search Result
      ↓
L1 Entity / Exploration Summary
      ↓
L2 Relation / Fact
      ↓
L3 Evidence
      ↓
L4 Raw Artifact
```

---

# 21. L0：Search

例如：

```text
tracebook.search("PPT 保存失败")
```

只返回：

```text
Exploration
AI PPT 保存链路

Service
ppt-service

Service
netdisk-service

API
POST /ppt/save
```

每条只包含：

```text
id
type
name
summary
score
```

---

# 22. L1：Entity / Exploration

Agent 认为相关后继续：

```text
tracebook.get_entity("service:ppt-service")
```

得到：

```text
Summary
Key Facts
Direct Relations
Recent Explorations
Evidence Count
```

或者：

```text
tracebook.get_exploration("ppt-save-flow")
```

得到过去一次完整调查摘要。

---

# 23. L2：Relation / Fact

继续查看：

```text
ppt-service

CALLS
→ sandbox-service
→ netdisk-service

READS
→ ppt_task

HANDLES
→ /ppt/save
```

同时返回关键 Facts。

---

# 24. L3：Evidence

只有 Agent 需要验证时：

```text
tracebook.get_evidence(...)
```

得到：

```text
Code Evidence ×2
Log Evidence ×3
Trace Evidence ×1
```

以及摘要和引用。

---

# 25. L4：Artifact

最后才：

```text
tracebook.read_artifact(...)
```

读取：

```text
真实日志
HTTP Body
代码片段
截图
SQL Result
```

因此 Token 使用天然受到控制。

---

# 26. Progressive Disclosure 不依赖 Multi-Agent

这一点需要明确：

> 渐进式披露是数据访问协议，不是 Agent 架构。

一个 Main Agent 就可以：

```text
search
 ↓
get_entity
 ↓
get_relation
 ↓
get_evidence
 ↓
read_artifact
```

完整实现渐进式查询。

因此 MVP 不需要 Knowledge Agent。

---

# 27. Multi-Agent 的定位

默认：

```text
Main Agent
    ↓
Tracebook Tools
```

只有当任务本身非常复杂，例如：

```text
“调查 AI PPT 从页面点击到最终文件落盘的完整流程。”
```

且需要大量：

```text
Search
Expand
Evidence
Cross-source Investigation
```

才考虑：

```text
Main Agent
     ↓
Knowledge Agent
     ↓
Tracebook
```

因此：

> Multi-Agent 是复杂任务的执行优化，不是 Tracebook 的基础前提。

不要为了架构上的“Agent 化”提前引入多 Agent。

---

# 28. Tracebook Tools

MVP 建议只提供：

```text
tracebook.search(query)

tracebook.get_entity(id)

tracebook.get_relations(entity_id, filters?)

tracebook.get_exploration(id)

tracebook.get_evidence(id)

tracebook.search_evidence(query, subject?)

tracebook.read_artifact(id, range?)

tracebook.write(...)
```

后续再增加：

```text
find_path()

get_neighbors()

get_history()

get_changes()

find_impact()
```

---

# 29. Search 的职责

Search 主要搜索：

```text
Entity Summary

Relation Summary

Fact

Exploration Summary

Evidence Summary
```

可以使用：

```text
Keyword Search
+
Semantic Search
```

但不需要：

```text
Embedding Everything
```

尤其不要把：

```text
完整日志
整个代码仓库
所有 HTTP Response
```

全部复制进 Vector DB。

---

# 30. 写入流程

一次 Exploration：

```text
Agent Investigation
        ↓
Raw Observation
        ↓
Evidence
        ↓
Identify Entity
        ↓
Identify Relation
        ↓
Extract Fact
        ↓
Write Tracebook
```

例如：

```text
代码发现：

PPTService.Save()
    ↓
NetdiskClient.Upload()
```

形成：

```text
Entity:
ppt-service

Entity:
netdisk-service

Relation:
ppt-service CALLS netdisk-service

Evidence:
code://ppt-service/xxx.go
```

---

# 31. 写入不应该完全自动化

MVP 可以由：

```text
Agent 主动判断
```

什么时候调用：

```text
tracebook.write()
```

暂时不要一开始实现：

```text
所有 Session 自动抽取

所有 Tool 调用自动入库

所有 Agent 推断自动形成 Fact
```

否则很容易产生大量低质量知识。

未来再逐步增加：

```text
Session End Extraction
Knowledge Review
Conflict Detection
Auto Promotion
```

---

# 32. 知识更新

知识不是永久正确的。

至少保存：

```text
created_at
updated_at
last_verified
source_version
```

例如：

```text
ppt-service → netdisk-service
```

以后变成：

```text
ppt-service
    ↓
storage-gateway
    ↓
netdisk-service
```

新的 Exploration 应该更新知识，同时保留必要历史。

未来再考虑：

```text
valid_from
valid_to
history
```

---

# 33. 存储方案

MVP 推荐：

```text
PostgreSQL
+
Object Storage
+
已有 Search Infrastructure
```

---

## PostgreSQL

存：

```text
Entity
Relation
Fact
Evidence Metadata
Exploration
Reference
```

使用 JSONB 保留扩展能力。

---

## Object Storage

保存：

```text
Screenshot
HAR
HTTP Body
Large Log
SQL Result
Report
```

---

## Search Engine

如果已有 Elasticsearch / OpenSearch，直接复用。

负责：

```text
Keyword
Semantic
Hybrid Search
```

暂时不需要额外引入独立 Vector DB。

---

# 34. 为什么暂时不需要 Neo4j

MVP：

```text
Entity Table
Relation Table
```

已经天然构成 Graph：

```text
Entity
 ↓
Relation
 ↓
Entity
```

PostgreSQL 足以支持：

```text
直接关系
简单递归查询
有限深度 Path
```

只有未来大量出现：

```text
复杂 N-hop 查询
影响面分析
大规模路径搜索
Dependency Graph
```

才考虑增加 Graph DB。

---

# 35. 可复用的成熟基础设施

Tracebook 应该充分利用现有系统。

## Sourcegraph / SCIP

负责：

```text
Repository
Symbol
Definition
Reference
Implementation
Cross-repository Code Navigation
```

Tracebook 只保存业务引用与关系。

---

## OpenTelemetry

负责：

```text
Trace
Span
Service
HTTP
Log Correlation
Metric Context
```

不要重新发明 Trace 协议。

---

## Backstage / 内部 Service Catalog

如果已有，可以作为：

```text
Service
API
Owner
Dependency
Repository
```

等 Entity 的基础来源。

---

## GraphRAG

值得参考：

```text
Entity Retrieval
Relation Expansion
Context Ranking
Local / Global Search
```

但 Tracebook 不直接等同于 GraphRAG。

GraphRAG 偏：

```text
Document
→ Entity / Relation Extraction
→ Retrieval
```

Tracebook 偏：

```text
Browser
HTTP
Trace
Log
Code
DB
Agent Exploration
        ↓
Evidence-backed Business Knowledge
```

---

# 36. Tracebook 的真正不可替代部分

项目真正应该自己建设的是四件事情。

## 1. Exploration

记录：

> Agent 为某个问题调查了什么、发现了什么。

---

## 2. Cross-source Knowledge

统一关联：

```text
Page
HTTP
Trace
Service
Code
Log
DB
```

而不是让信息散落在多个系统。

---

## 3. Evidence-backed Knowledge

所有重要业务知识都能回溯：

```text
Knowledge
   ↓
Evidence
   ↓
Original Source
```

---

## 4. Agent-native Retrieval

未来 Agent 能：

```text
Search
→ Discover
→ Expand
→ Verify
```

而不是重新探索一遍真实系统。

---

# 37. UI 定位

Tracebook 对人来说也是一个 Business Explorer。

建议主要页面：

```text
Search

Explorations

Entities

Business Graph

Evidence
```

Entity 页面：

```text
ppt-service

Summary

Relations
├── Called By
├── Calls
├── Handles
├── Reads
└── Writes

Facts

Recent Explorations

Evidence

Source References
```

Exploration 页面：

```text
AI PPT 保存链路

Goal

Summary

Flow

Timeline

Entities

Relations

Findings

Evidence

Artifacts
```

---

# 38. MVP 范围

第一版只保证：

```text
Write
Search
Explore
Verify
Reuse
```

需要实现：

```text
Entity
Relation
Fact
Evidence
Artifact
Exploration

Search

Entity Detail
Exploration Detail

Evidence Retrieval

Write API

PostgreSQL

Artifact Storage

DSH Plugin UI

Agent Tools
```

---

# 39. MVP 明确不做

暂时删除以下设计：

```text
❌ 固定规则式 Knowledge Context Builder

❌ 强制所有查询通过 Knowledge Agent

❌ 一开始多 Agent 化

❌ Tracebook 永久绑定 DSH Host

❌ 自研代码搜索 / Code Graph

❌ 自研 Trace / Log 系统

❌ 全量代码进入知识库

❌ 全量日志进入知识库

❌ Embedding Everything

❌ Neo4j 优先

❌ 复杂 Ontology

❌ 复杂 GraphRAG

❌ 自动把所有 Session 内容沉淀为知识

❌ AI 推断直接升级为事实
```

---

# 40. 当前最终架构原则

可以浓缩成以下几条：

```text
1. Tracebook 是业务认知层，不是原始数据仓库。

2. Exploration 是 Agent 调查的核心记录单位。

3. Entity / Relation / Fact 表达长期业务知识。

4. Evidence 负责证明知识，Artifact 保存原始数据。

5. 原始代码、日志、Trace、DB 继续留在原有系统。

6. 跨源关系优先依靠 trace_id、request_id、metadata、
   AST 等确定性信息建立。

7. LLM 负责理解和补充语义，而不是承担所有关联工作。

8. Progressive Disclosure 通过 Tool/API 层级自然实现，
   不依赖 Multi-Agent。

9. Main Agent 默认直接操作 Tracebook Tools。

10. Knowledge Agent 只有在复杂任务中按需引入。

11. DSH Plugin 是主要交互入口，但 Tracebook Core
    应保持独立接口和未来独立部署能力。

12. 尽量复用 Sourcegraph、OpenTelemetry、
    日志平台、Service Catalog 等成熟基础设施。

13. MVP 优先打通：
    Write → Search → Explore → Verify → Reuse。
```

---

# 41. 一句话定义

> **Tracebook 是一个面向 Agent 的业务探索与认知层：它把页面、HTTP、Trace、代码、日志、数据库等真实业务信息组织成可追溯的长期知识，并允许未来 Agent 通过渐进式查询继续探索和验证，而不是每次从零重新理解业务。**

---

# 42. 后续最值得继续讨论的问题

架构方向基本确定后，下一阶段应该转向具体数据与协议设计：

1. Entity 如何进行唯一标识和去重
2. Relation Type 是否需要固定 Schema
3. Exploration 的完整数据结构
4. Evidence 与 Source Reference 的模型
5. `tracebook.write()` 的写入协议
6. Agent 如何判断哪些知识值得长期沉淀
7. 新旧知识冲突与更新策略
8. Browser / HTTP / Trace / Code 的自动关联实现
9. Tracebook Plugin 与独立 Core API 的接口定义
10. MVP 数据库 Schema 与页面原型

其中最优先的是：

> **先定义 Exploration + Evidence + Entity / Relation 的实际数据协议，并拿一个真实业务链路完整跑通。**

例如直接用：

```text
AI PPT 页面
→ 点击生成
→ HTTP
→ Trace
→ ppt-service
→ 代码
→ sandbox-service
→ netdisk-service
→ Log
→ DB
```

作为第一条端到端样例。

只要这条链路能够做到：

```text
自动采集
→ 自动关联
→ Agent 补充认知
→ 写入 Tracebook
→ 新 Session 搜出来
→ 沿 Evidence 回查
```

Tracebook 的核心闭环就成立了。