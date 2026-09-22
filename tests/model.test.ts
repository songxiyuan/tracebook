import { describe, expect, it } from 'vitest'
import { blockSchema } from '../src/core/model.js'

describe('block schema', () => {
  it('accepts all seven MVP block types', () => {
    const blocks = [
      { id: 'm', type: 'markdown', content: '# Result' },
      { id: 'f', type: 'facts', items: [{ label: 'mode', value: 'async' }] },
      { id: 'g', type: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] },
      { id: 't', type: 'table', columns: [{ key: 'api', label: 'API' }], rows: [{ api: '/generate' }] },
      { id: 'tl', type: 'timeline', items: [{ title: 'Created' }] },
      { id: 'e', type: 'evidence', items: [{ id: 'ev', kind: 'code', title: 'Handler' }] },
      { id: 'ga', type: 'gallery', items: [{ artifactRef: 'shot' }] },
    ]
    expect(blocks.map((block) => blockSchema.parse(block).type)).toHaveLength(7)
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
