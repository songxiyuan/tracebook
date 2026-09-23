import { describe, expect, it } from 'vitest'
import { blockSchema } from '../src/core/model.js'

describe('block schema', () => {
  it('accepts all eight MVP block types', () => {
    const blocks = [
      { id: 'm', type: 'markdown', content: '# Result' },
      { id: 'f', type: 'facts', items: [{ label: 'mode', value: 'async' }] },
      { id: 'g', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] },
      { id: 't', type: 'table', columns: [{ key: 'api', label: 'API' }], rows: [{ api: '/generate' }] },
      { id: 'tl', type: 'timeline', items: [{ title: 'Created' }] },
      { id: 'e', type: 'evidence', items: [{ id: 'ev', kind: 'code', title: 'Handler' }] },
      { id: 'ga', type: 'gallery', items: [{ artifactRef: 'shot' }] },
      { id: 'a', type: 'api', endpoints: [{ id: 'create', method: 'POST', path: '/slides' }] },
    ]
    expect(blocks.map((block) => blockSchema.parse(block).type)).toHaveLength(8)
  })

  it('rejects flow edges that reference missing nodes', () => {
    const result = blockSchema.safeParse({
      id: 'flow', type: 'flow', nodes: [{ id: 'a', label: 'A' }],
      edges: [{ id: 'broken', source: 'a', target: 'missing' }],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('missing target')
  })
})

describe('api block', () => {
  function endpoint(patch: Record<string, unknown> = {}) {
    return { id: 'create', method: 'POST', path: '/slides', ...patch }
  }

  it('normalises the HTTP method to its canonical uppercase form', () => {
    const parsed = blockSchema.parse({
      id: 'api', type: 'api', endpoints: [endpoint({ method: ' post ' })],
    })
    if (parsed.type !== 'api') throw new Error('expected an api block')
    expect(parsed.endpoints[0]?.method).toBe('POST')
  })

  it('rejects a method that is not a standard HTTP verb', () => {
    const result = blockSchema.safeParse({
      id: 'api', type: 'api', endpoints: [endpoint({ method: 'FETCH' })],
    })
    expect(result.success).toBe(false)
  })

  it('keeps timing provenance mandatory and never empty', () => {
    const missingSource = blockSchema.safeParse({
      id: 'api', type: 'api', endpoints: [endpoint({ timing: { p95: 46 } })],
    })
    expect(missingSource.success).toBe(false)

    const emptyTiming = blockSchema.safeParse({
      id: 'api', type: 'api', endpoints: [endpoint({ timing: { source: 'log' } })],
    })
    expect(emptyTiming.success).toBe(false)

    const observed = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ timing: { source: 'log', sampleSize: 240, p50: 17, p95: 46 } })],
    })
    expect(observed.success).toBe(true)
  })

  it('accepts an endpoint without timing, because not every endpoint has a measurable duration', () => {
    const result = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ responses: [{ status: 200, contentType: 'text/event-stream' }] })],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an example that does not say where it came from', () => {
    const body = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ request: { body: { contentType: 'application/json', example: { topic: 'x' } } } })],
    })
    expect(body.success).toBe(false)

    const response = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ responses: [{ status: 200, example: { job_id: 'j1' } }] })],
    })
    expect(response.success).toBe(false)

    const sourced = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({
        request: { body: { contentType: 'application/json', example: { topic: 'x' }, source: 'observed' } },
        responses: [{ status: 200, example: { job_id: 'j1' }, source: 'inferred' }],
      })],
    })
    expect(sourced.success).toBe(true)
  })

  it('keeps the derived error rate consistent by rejecting errorCount above sampleSize', () => {
    const impossible = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ timing: { source: 'log', sampleSize: 10, errorCount: 11, p95: 46 } })],
    })
    expect(impossible.success).toBe(false)

    const consistent = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ timing: { source: 'log', sampleSize: 10, errorCount: 2, p95: 46 } })],
    })
    expect(consistent.success).toBe(true)
  })

  it('keeps a declared target on the endpoint, separate from an observation', () => {
    const declaredOnly = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ expectedMs: 200, expectedRef: 'x-expected-response-time-ms' })],
    })
    expect(declaredOnly.success).toBe(true)

    const parsed = blockSchema.parse({
      id: 'api', type: 'api',
      endpoints: [endpoint({
        expectedMs: 200,
        timing: { source: 'log', sampleSize: 10, p95: 460 },
      })],
    })
    if (parsed.type !== 'api') throw new Error('expected an api block')
    // A declared budget alone never satisfies the "has an observation" rule.
    expect(parsed.endpoints[0]?.expectedMs).toBe(200)
    expect(blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [endpoint({ expectedMs: 200 })],
    }).success).toBe(true)
  })
})
