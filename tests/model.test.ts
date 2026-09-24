import { describe, expect, it } from 'vitest'
import { blockSchema, buildBlockSchemaReference } from '../src/core/model.js'

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

  it('rejects duplicate ids within a block (P1-1)', () => {
    const dupNode = blockSchema.safeParse({
      id: 'flow', type: 'flow',
      nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }], edges: [],
    })
    expect(dupNode.success).toBe(false)

    const dupColumn = blockSchema.safeParse({
      id: 'table', type: 'table',
      columns: [{ key: 'k', label: 'One' }, { key: 'k', label: 'Two' }], rows: [],
    })
    expect(dupColumn.success).toBe(false)

    const dupEndpoint = blockSchema.safeParse({
      id: 'api', type: 'api',
      endpoints: [
        { id: 'create', method: 'POST', path: '/slides' },
        { id: 'create', method: 'GET', path: '/slides' },
      ],
    })
    expect(dupEndpoint.success).toBe(false)
  })
})

describe('block schema reference', () => {
  it('exposes a per-type field reference for tool discovery', () => {
    const reference = buildBlockSchemaReference()
    for (const type of ['markdown', 'facts', 'flow', 'table', 'timeline', 'evidence', 'gallery', 'api', 'sequence']) {
      expect(reference).toContain(`${type}:`)
    }
  })

  // Regression: the reference used to list only the top-level array field name
  // (`items`, `edges`, `columns`), so a model guessed the element shape and hit
  // INVALID_INPUT — facts items as bare strings, flow edges as {from,to}, table
  // columns as a 2-D array. The element shape must be spelled out inline.
  it('spells out the element shape of object-array fields', () => {
    const reference = buildBlockSchemaReference()
    expect(reference).toContain('items[{label, value}]')
    expect(reference).toMatch(/edges\??\[\{id, source, target[^\]]*\}\]/)
    expect(reference).toContain('columns[{key, label}]')
    // The bare field name must no longer stand alone for these fields.
    expect(reference).not.toMatch(/facts:[^\n]*\bitems\b(?!\[)/)
    expect(reference).not.toMatch(/flow:[^\n]*\bedges\b(?!\??\[)/)
    expect(reference).not.toMatch(/table:[^\n]*\bcolumns\b(?!\[)/)
  })
})

describe('sequence block', () => {
  function sequence(patch: Record<string, unknown> = {}) {
    return {
      id: 'seq', type: 'sequence',
      participants: [
        { id: 'page', label: 'PPT Page', kind: 'page' },
        { id: 'svc', label: 'Slide Service', kind: 'service' },
      ],
      messages: [
        { id: 'm1', from: 'page', to: 'svc', label: 'create', kind: 'sync', status: 200, durationMs: 120 },
        { id: 'm2', from: 'svc', to: 'page', label: 'notice', kind: 'stream', timingSource: 'trace' },
      ],
      ...patch,
    }
  }

  it('parses a valid sequence and defaults message kind to sync', () => {
    const parsed = blockSchema.parse(sequence({
      messages: [{ id: 'm1', from: 'page', to: 'svc', label: 'create' }],
    }))
    if (parsed.type !== 'sequence') throw new Error('expected a sequence block')
    expect(parsed.messages[0]?.kind).toBe('sync')
    expect(parsed.participants).toHaveLength(2)
  })

  it('rejects a message that references a participant that was never declared', () => {
    const result = blockSchema.safeParse(sequence({
      messages: [{ id: 'm1', from: 'page', to: 'ghost', label: 'create' }],
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('missing to ghost')
  })

  it('rejects duplicate participant ids within the block (P1-1)', () => {
    const result = blockSchema.safeParse(sequence({
      participants: [
        { id: 'page', label: 'PPT Page' },
        { id: 'page', label: 'Duplicate' },
      ],
    }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('Duplicate sequence participant id'))).toBe(true)
  })

  it('rejects a message status outside the HTTP range', () => {
    const result = blockSchema.safeParse(sequence({
      messages: [{ id: 'm1', from: 'page', to: 'svc', label: 'create', status: 42 }],
    }))
    expect(result.success).toBe(false)
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

describe('flow block variants (archify diagrams)', () => {
  const workflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Usage flow' },
    lanes: [{ id: 'user', label: 'User' }],
    nodes: [
      { id: 'ask', lane: 'user', col: 0, type: 'frontend', label: 'Tell AI' },
      { id: 'run', lane: 'user', col: 1, type: 'backend', label: 'Process' },
    ],
    edges: [{ id: 'e1', from: 'ask', to: 'run', role: 'main' }],
  }

  it('defaults an omitted variant to basic', () => {
    const parsed = blockSchema.parse({ id: 'g', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] })
    if (parsed.type !== 'flow') throw new Error('expected a flow block')
    expect(parsed.variant).toBe('basic')
  })

  it('accepts an embedded archify workflow diagram', () => {
    const parsed = blockSchema.parse({ id: 'wf', type: 'flow', variant: 'workflow', diagram: workflow })
    if (parsed.type !== 'flow') throw new Error('expected a flow block')
    expect(parsed.variant).toBe('workflow')
    expect(parsed.diagram?.diagram_type).toBe('workflow')
  })

  it('preserves archify pixel/routing hint fields through a parse (loose objects)', () => {
    const parsed = blockSchema.parse({
      id: 'wf', type: 'flow', variant: 'workflow',
      diagram: {
        ...workflow,
        edges: [{ id: 'e1', from: 'ask', to: 'run', role: 'main', route: 'orthogonal', via: [[1, 2]], channelX: 40 }],
      },
    })
    if (parsed.type !== 'flow' || parsed.diagram?.diagram_type !== 'workflow') throw new Error('expected a workflow flow block')
    const edge = parsed.diagram.edges[0] as Record<string, unknown>
    expect(edge.channelX).toBe(40)
    expect(edge.via).toEqual([[1, 2]])
  })

  it('rejects a variant whose diagram_type does not match', () => {
    const result = blockSchema.safeParse({ id: 'wf', type: 'flow', variant: 'dataflow', diagram: workflow })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('does not match diagram_type'))).toBe(true)
  })

  it('requires a diagram for a typed variant', () => {
    const result = blockSchema.safeParse({ id: 'wf', type: 'flow', variant: 'workflow' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('requires a "diagram"'))).toBe(true)
  })

  it('rejects an archify edge that points at a missing node', () => {
    const result = blockSchema.safeParse({
      id: 'wf', type: 'flow', variant: 'workflow',
      diagram: { ...workflow, edges: [{ id: 'e1', from: 'ask', to: 'ghost' }] },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('missing to ghost'))).toBe(true)
  })

  it('rejects an architecture boundary that wraps a missing component', () => {
    const result = blockSchema.safeParse({
      id: 'arch', type: 'flow', variant: 'architecture',
      diagram: {
        schema_version: 1,
        diagram_type: 'architecture',
        meta: { title: 'System' },
        components: [{ id: 'web', type: 'frontend', label: 'Web' }],
        boundaries: [{ kind: 'region', label: 'VPC', wraps: ['web', 'ghost'] }],
      },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('references missing node ghost'))).toBe(true)
  })

  it('accepts lifecycle and dataflow diagrams', () => {
    const lifecycle = blockSchema.safeParse({
      id: 'lc', type: 'flow', variant: 'lifecycle',
      diagram: {
        schema_version: 1, diagram_type: 'lifecycle', meta: { title: 'States' },
        lanes: [{ id: 'main', label: 'Main' }],
        states: [
          { id: 's0', type: 'start', label: 'Start', lane: 'main', col: 0 },
          { id: 's1', type: 'success', label: 'Done', lane: 'main', col: 1 },
        ],
        transitions: [{ from: 's0', to: 's1' }],
      },
    })
    expect(lifecycle.success).toBe(true)

    const dataflow = blockSchema.safeParse({
      id: 'df', type: 'flow', variant: 'dataflow',
      diagram: {
        schema_version: 1, diagram_type: 'dataflow', meta: { title: 'Pipeline' },
        stages: [{ label: 'Ingest' }, { label: 'Serve' }],
        nodes: [
          { id: 'src', type: 'external', label: 'Source', stage: 0, row: 0 },
          { id: 'sink', type: 'database', label: 'Store', stage: 1, row: 0 },
        ],
        flows: [{ from: 'src', to: 'sink', label: 'rows' }],
      },
    })
    expect(dataflow.success).toBe(true)
  })
})
