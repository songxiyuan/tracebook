import type { TracebookService } from './core/service.js'

export const EXAMPLE_CASE_TITLE = 'PPT 生成功能全链路调查'

const screenshotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#07110f"/><stop offset="1" stop-color="#173d2e"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#bg)"/><rect x="72" y="54" width="1136" height="612" rx="24" fill="#0d1d18" stroke="#315347"/>
  <text x="118" y="128" fill="#92f2b4" font-family="monospace" font-size="22">PRESENTATION STUDIO</text>
  <text x="118" y="214" fill="#e8f2ee" font-family="sans-serif" font-size="54" font-weight="700">Create a presentation</text>
  <rect x="118" y="270" width="720" height="142" rx="14" fill="#12261f" stroke="#315347"/>
  <text x="150" y="320" fill="#829b91" font-family="sans-serif" font-size="20">Describe your topic</text>
  <text x="150" y="370" fill="#dbe9e4" font-family="sans-serif" font-size="25">Q3 product strategy and growth plan</text>
  <rect x="118" y="454" width="250" height="72" rx="36" fill="#92f2b4"/><text x="177" y="500" fill="#07110f" font-family="sans-serif" font-size="22" font-weight="700">Generate PPT</text>
  <rect x="890" y="254" width="252" height="320" rx="18" fill="#10251e" stroke="#315347"/>
  <rect x="920" y="292" width="192" height="108" rx="8" fill="#ffd58a" opacity=".9"/><rect x="920" y="426" width="150" height="14" rx="7" fill="#92f2b4"/><rect x="920" y="460" width="192" height="10" rx="5" fill="#587067"/><rect x="920" y="486" width="176" height="10" rx="5" fill="#587067"/>
</svg>`

export async function seedExampleCase(service: TracebookService): Promise<string> {
  const existing = (await service.listCases()).find((item) =>
    item.type === 'example' && item.title === EXAMPLE_CASE_TITLE,
  )
  if (existing?.blockCount === 7 && existing.artifactCount === 4) return existing.id

  const opened = existing
    ? await service.open({ caseId: existing.id, sourceSessionId: 'tracebook-example-seed' })
    : await service.open({
        title: EXAMPLE_CASE_TITLE,
        type: 'example',
        environment: 'production-mock',
        sourceSessionId: 'tracebook-example-seed',
      })

  await service.update({
    caseId: opened.caseId,
    expectedRevision: opened.revision,
    status: 'completed',
    summary: '用户在 PPT 页面提交主题后，前端创建异步任务；请求经 API Gateway 路由到 slide-service，写入 slide.generate 队列，由 slide-worker 生成文件并将状态回写 PostgreSQL，页面通过 SSE 获得完成通知。以下数据均为用于演示 Tracebook 完整能力的 mock 数据。',
    upsertBlocks: [
      {
        id: 'overview',
        type: 'markdown',
        title: '调查结论',
        content: [
          '## 结论',
          '',
          'PPT 生成采用 **异步任务 + SSE 通知**。同步请求只负责创建任务，真正的渲染由 Worker 完成。',
          '',
          '### 当前边界',
          '',
          '- 已确认页面、API、Gateway、Service、消息队列、Worker、数据库与对象存储链路。',
          '- 调查数据为演示用途，不对应真实生产系统。',
          '- 重试策略为指数退避，最多 3 次；最终失败进入死信队列。',
        ].join('\n'),
      },
      {
        id: 'key-facts',
        type: 'facts',
        title: '已确认信息',
        items: [
          { label: '生成接口', value: 'POST /api/slides/generate' },
          { label: '线上服务', value: 'slide-service' },
          { label: '消息主题', value: 'slide.generate' },
          { label: '执行 Worker', value: 'slide-worker' },
          { label: '状态存储', value: 'PostgreSQL / slide_jobs' },
          { label: '结果存储', value: 'Object Storage' },
        ],
      },
      {
        id: 'backend-flow',
        type: 'flow',
        title: '端到端调用链',
        description: '点击节点可查看职责、关联 Block 与原始记录。',
        direction: 'LR',
        nodes: [
          { id: 'page', label: 'PPT Page', kind: 'page', details: '收集主题与模板参数，订阅任务 SSE。', artifactRefs: ['demo-screenshot'], relatedBlockIds: ['page-gallery'] },
          { id: 'api', label: 'POST /slides/generate', kind: 'api', details: '校验请求并创建生成任务。', artifactRefs: ['demo-http'], relatedBlockIds: ['api-list'] },
          { id: 'gateway', label: 'API Gateway', kind: 'gateway', details: '鉴权并将 /api/slides/* 路由到 slide-service。' },
          { id: 'service', label: 'slide-service', kind: 'service', details: '持久化任务并发布 slide.generate 消息。', artifactRefs: ['demo-trace'], relatedBlockIds: ['key-evidence'] },
          { id: 'queue', label: 'slide.generate', kind: 'queue', details: '异步任务 Topic，按 job_id 分区。' },
          { id: 'worker', label: 'slide-worker', kind: 'worker', details: '生成大纲、渲染页面并上传 PPTX。', artifactRefs: ['demo-code'], relatedBlockIds: ['execution-timeline'] },
          { id: 'database', label: 'PostgreSQL', kind: 'database', details: 'slide_jobs 保存状态、进度与结果 URL。' },
          { id: 'storage', label: 'Object Storage', kind: 'storage', details: '保存最终 PPTX 与预览图。' },
          { id: 'sse', label: 'SSE /events', kind: 'api', details: '向页面推送 processing、completed 或 failed。' },
        ],
        edges: [
          { id: 'page-api', source: 'page', target: 'api', label: 'SUBMIT' },
          { id: 'api-gateway', source: 'api', target: 'gateway', label: 'HTTPS' },
          { id: 'gateway-service', source: 'gateway', target: 'service', label: 'ROUTES TO' },
          { id: 'service-db', source: 'service', target: 'database', label: 'CREATE JOB' },
          { id: 'service-queue', source: 'service', target: 'queue', label: 'PUBLISH' },
          { id: 'queue-worker', source: 'queue', target: 'worker', label: 'CONSUME' },
          { id: 'worker-storage', source: 'worker', target: 'storage', label: 'UPLOAD' },
          { id: 'worker-db', source: 'worker', target: 'database', label: 'UPDATE STATUS' },
          { id: 'database-sse', source: 'database', target: 'sse', label: 'CHANGE EVENT' },
          { id: 'sse-page', source: 'sse', target: 'page', label: 'NOTIFY' },
        ],
      },
      {
        id: 'api-list',
        type: 'table',
        title: '接口清单',
        columns: [
          { key: 'method', label: 'Method' },
          { key: 'path', label: 'Path' },
          { key: 'service', label: 'Service' },
          { key: 'description', label: '作用' },
        ],
        rows: [
          { method: 'POST', path: '/api/slides/generate', service: 'slide-service', description: '创建 PPT 生成任务' },
          { method: 'GET', path: '/api/slides/jobs/:id', service: 'slide-service', description: '查询任务状态与进度' },
          { method: 'GET', path: '/api/slides/jobs/:id/events', service: 'slide-service', description: '订阅 SSE 状态变化' },
          { method: 'GET', path: '/api/slides/jobs/:id/download', service: 'slide-service', description: '获取短期下载地址' },
        ],
      },
      {
        id: 'execution-timeline',
        type: 'timeline',
        title: '一次生成任务的业务时间线',
        items: [
          { timestamp: 'T+0 ms', title: '页面提交', description: '用户填写主题并点击 Generate PPT。', artifactRefs: ['demo-screenshot'] },
          { timestamp: 'T+85 ms', title: '任务创建', description: 'slide-service 写入 slide_jobs，返回 job_id。', artifactRefs: ['demo-http'] },
          { timestamp: 'T+130 ms', title: '消息发布', description: '事务提交后发布 slide.generate。' },
          { timestamp: 'T+420 ms', title: 'Worker 开始执行', description: '生成大纲并逐页渲染，持续回写进度。', artifactRefs: ['demo-trace', 'demo-code'] },
          { timestamp: 'T+18.4 s', title: '文件上传', description: 'PPTX 与预览图写入对象存储。' },
          { timestamp: 'T+18.7 s', title: '页面收到完成事件', description: 'SSE 推送 completed，页面显示下载入口。' },
        ],
      },
      {
        id: 'key-evidence',
        type: 'evidence',
        title: '关键发现',
        items: [
          { id: 'ev-screen', kind: 'screenshot', title: 'PPT 创建页面', summary: '页面提供主题输入框和 Generate PPT 操作。', artifactRef: 'demo-screenshot' },
          { id: 'ev-http', kind: 'http', title: '创建任务 HTTP 记录', summary: 'POST 返回 202 与 job_id，证明同步请求只创建任务。', artifactRef: 'demo-http' },
          { id: 'ev-trace', kind: 'trace', title: '服务端 Trace', summary: 'Trace 显示 gateway → slide-service → queue publish。', artifactRef: 'demo-trace' },
          { id: 'ev-code', kind: 'code', title: 'Worker 消费代码', summary: '消费者处理 slide.generate 并更新 slide_jobs。', artifactRef: 'demo-code' },
        ],
      },
      {
        id: 'page-gallery',
        type: 'gallery',
        title: '页面截图',
        items: [
          { artifactRef: 'demo-screenshot', caption: 'PPT 创建页（mock）' },
        ],
      },
    ],
    artifacts: [
      {
        id: 'demo-screenshot', kind: 'screenshot', mimeType: 'image/svg+xml', name: 'ppt-create-page.svg',
        summary: 'PPT 创建页 mock 截图', contentText: screenshotSvg,
      },
      {
        id: 'demo-http', kind: 'http', mimeType: 'application/json', name: 'create-job-http.json',
        summary: '创建任务请求与响应',
        contentText: JSON.stringify({
          request: { method: 'POST', path: '/api/slides/generate', body: { topic: 'Q3 product strategy', template: 'modern' } },
          response: { status: 202, body: { job_id: 'job_mock_01', status: 'queued' } },
        }, null, 2),
      },
      {
        id: 'demo-trace', kind: 'trace', mimeType: 'application/json', name: 'generation-trace.json',
        summary: '一次生成请求的 mock Trace',
        contentText: JSON.stringify({ traceId: 'trace_mock_01', spans: [
          { service: 'api-gateway', operation: 'POST /api/slides/generate', durationMs: 12 },
          { service: 'slide-service', operation: 'createJob', durationMs: 73 },
          { service: 'slide-service', operation: 'publish slide.generate', durationMs: 31 },
        ] }, null, 2),
      },
      {
        id: 'demo-code', kind: 'code', mimeType: 'text/plain', name: 'slide-worker.ts',
        summary: 'Worker 消费逻辑 mock 代码',
        contentText: `consumer.on('slide.generate', async (job) => {\n  const result = await renderPresentation(job);\n  const url = await objectStore.put(result);\n  await slideJobs.complete(job.id, url);\n});\n`,
      },
    ],
  })

  return opened.caseId
}
