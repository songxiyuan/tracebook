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

/**
 * A HAR 1.2 capture for the download endpoint.
 *
 * `entry.time` must equal the sum of the non-`-1` timings, so the phase numbers
 * here add up to `time` by construction (HAR treats `ssl` as a sub-interval of
 * `connect`, not a sibling, so it is not added again).
 */
export const EXAMPLE_HAR_DOCUMENT = {
  log: {
    version: '1.2',
    creator: { name: 'Tracebook mock capture', version: '1.0' },
    browser: { name: 'Chrome', version: '140.0' },
    entries: [
      {
        startedDateTime: '2026-09-23T02:15:00.000Z',
        time: 58,
        request: {
          method: 'GET',
          url: 'https://studio.example.com/api/slides/jobs/job_mock_01/download',
          httpVersion: 'HTTP/2',
          headers: [{ name: 'accept', value: 'application/json' }],
          cookies: [],
          queryString: [],
          headersSize: 148,
          bodySize: 0,
        },
        response: {
          status: 302,
          statusText: 'Found',
          httpVersion: 'HTTP/2',
          headers: [{ name: 'location', value: 'https://cdn.example.com/slides/job_mock_01.pptx?sig=mock' }],
          cookies: [],
          content: { size: 0, mimeType: 'text/plain' },
          redirectURL: 'https://cdn.example.com/slides/job_mock_01.pptx?sig=mock',
          headersSize: 168,
          bodySize: 0,
        },
        timings: { blocked: 0, dns: 2, connect: 9, ssl: 4, send: 0, wait: 41, receive: 6 },
      },
      {
        startedDateTime: '2026-09-23T02:16:30.000Z',
        time: 74,
        request: {
          method: 'GET',
          url: 'https://studio.example.com/api/slides/jobs/job_mock_02/download',
          httpVersion: 'HTTP/2',
          headers: [{ name: 'accept', value: 'application/json' }],
          cookies: [],
          queryString: [],
          headersSize: 148,
          bodySize: 0,
        },
        response: {
          status: 302,
          statusText: 'Found',
          httpVersion: 'HTTP/2',
          headers: [{ name: 'location', value: 'https://cdn.example.com/slides/job_mock_02.pptx?sig=mock' }],
          cookies: [],
          content: { size: 0, mimeType: 'text/plain' },
          redirectURL: 'https://cdn.example.com/slides/job_mock_02.pptx?sig=mock',
          headersSize: 168,
          bodySize: 0,
        },
        timings: { blocked: 1, dns: 3, connect: 11, ssl: 5, send: 0, wait: 52, receive: 7 },
      },
    ],
  },
}

export async function seedExampleCase(service: TracebookService): Promise<string> {
  const existing = (await service.listCases()).find((item) =>
    item.type === 'example' && item.title === EXAMPLE_CASE_TITLE,
  )
  if (existing?.blockCount === 8 && existing.artifactCount === 5) return existing.id

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
        type: 'api',
        title: '接口清单',
        description: '点击任意接口展开输入、输出与观测耗时。耗时数字必须标注来源：Trace / HAR / Log 为实测，估算单独标记。',
        endpoints: [
          {
            id: 'generate',
            method: 'POST',
            path: '/api/slides/generate',
            service: 'slide-service',
            summary: '创建 PPT 生成任务',
            expectedMs: 200,
            expectedRef: 'x-expected-response-time-ms',
            request: {
              body: {
                contentType: 'application/json',
                example: { topic: 'Q3 product strategy and growth plan', template: 'modern' },
                source: 'observed',
              },
            },
            responses: [{
              status: 202,
              description: '任务已创建，返回 job_id',
              contentType: 'application/json',
              example: { job_id: 'job_mock_01', status: 'queued' },
              source: 'observed',
              artifactRef: 'demo-http',
            }],
            timing: {
              source: 'trace',
              sampleSize: 12,
              errorCount: 0,
              samples: [72, 78, 81, 85, 88, 91, 94, 99, 104, 112, 128, 141],
              p50: 89,
              p95: 138,
              max: 141,
              window: { from: '2026-09-23T01:45:00.000Z', to: '2026-09-23T02:15:00.000Z' },
              measuredAt: '2026-09-23T02:15:00.000Z',
              note: '取自 30 分钟窗口内 12 次 mock 调用的服务端 Trace。',
              artifactRef: 'demo-trace',
            },
            artifactRefs: ['demo-http', 'demo-trace'],
            relatedBlockIds: ['key-evidence'],
          },
          {
            id: 'job-status',
            method: 'GET',
            path: '/api/slides/jobs/:id',
            service: 'slide-service',
            summary: '查询任务状态与进度',
            expectedMs: 100,
            expectedRef: 'x-expected-response-time-ms',
            request: {
              params: [{ name: 'id', in: 'path', type: 'string', required: true, example: 'job_mock_01', source: 'observed' }],
            },
            responses: [{
              status: 200,
              description: '任务状态',
              contentType: 'application/json',
              example: { job_id: 'job_mock_01', status: 'processing', progress: 0.4 },
              source: 'observed',
            }],
            timing: {
              source: 'log',
              sampleSize: 240,
              errorCount: 5,
              p50: 17,
              p95: 46,
              p99: 88,
              max: 210,
              window: { from: '2026-09-23T01:00:00.000Z', to: '2026-09-23T02:00:00.000Z' },
              measuredAt: '2026-09-23T02:00:00.000Z',
              note: '由网关访问日志聚合，样本数 240。',
            },
          },
          {
            id: 'job-events',
            method: 'GET',
            path: '/api/slides/jobs/:id/events',
            service: 'slide-service',
            summary: '订阅 SSE 状态变化',
            request: {
              params: [{ name: 'id', in: 'path', type: 'string', required: true, example: 'job_mock_01', source: 'observed' }],
            },
            responses: [{
              status: 200,
              description: 'SSE 事件流，推送 processing / completed / failed',
              contentType: 'text/event-stream',
            }],
          },
          {
            id: 'job-download',
            method: 'GET',
            path: '/api/slides/jobs/:id/download',
            service: 'slide-service',
            summary: '获取短期下载地址',
            responses: [{
              status: 302,
              description: '重定向到对象存储签名地址',
            }],
            timing: {
              source: 'har',
              sampleSize: 2,
              samples: [58, 74],
              p50: 58,
              p95: 74,
              max: 74,
              breakdown: { dns: 2, connect: 9, ttfb: 41, download: 6 },
              window: { from: '2026-09-23T02:15:00.000Z', to: '2026-09-23T02:16:30.000Z' },
              measuredAt: '2026-09-23T02:16:30.000Z',
              note: '来自一次浏览器 HAR 导出的两次下载请求。',
              artifactRef: 'demo-har',
            },
          },
          {
            id: 'template-list',
            method: 'GET',
            path: '/api/slides/templates',
            service: 'slide-service',
            summary: '模板列表',
            responses: [{
              status: 200,
              description: '可用模板',
              contentType: 'application/json',
              example: ['modern', 'classic'],
              source: 'inferred',
            }],
            timing: {
              source: 'estimated',
              p50: 30,
              note: '未采样，按同服务只读接口推断，仅供排序参考。',
            },
          },
        ],
      },
      {
        id: 'storage-tables',
        type: 'table',
        title: '数据表与存储清单',
        columns: [
          { key: 'target', label: 'Target' },
          { key: 'store', label: 'Store' },
          { key: 'purpose', label: '作用' },
        ],
        rows: [
          { target: 'slide_jobs', store: 'PostgreSQL', purpose: '保存任务状态、进度与结果 URL' },
          { target: 'slide_events', store: 'PostgreSQL', purpose: '状态变更事件，供 SSE 推送' },
          { target: 'slides/{job_id}.pptx', store: 'Object Storage', purpose: '最终 PPTX 与预览图' },
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
          { id: 'ev-har', kind: 'har', title: '下载请求 HAR', summary: '两次下载请求的完整相位耗时，用于逐请求比对。', artifactRef: 'demo-har' },
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
      {
        id: 'demo-har', kind: 'har', mimeType: 'application/json', name: 'download-requests.har',
        summary: '下载接口的浏览器 HAR 导出（mock，2 次请求）',
        contentText: JSON.stringify(EXAMPLE_HAR_DOCUMENT, null, 2),
      },
    ],
  })

  return opened.caseId
}
