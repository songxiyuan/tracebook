import { describe, expect, it } from 'vitest'
import { MetadataOnlyArtifactStore } from '../src/core/artifact-store.js'
import { MemoryCaseRepository } from '../src/core/memory-repository.js'
import { TracebookService } from '../src/core/service.js'
import { EXAMPLE_CASE_TITLE, seedExampleCase } from '../src/example.js'

describe('example case', () => {
  it('seeds one complete, idempotent case', async () => {
    const service = new TracebookService(new MemoryCaseRepository(), new MetadataOnlyArtifactStore())
    const firstId = await seedExampleCase(service)
    const secondId = await seedExampleCase(service)
    const document = await service.requireCase(firstId)

    expect(secondId).toBe(firstId)
    expect((await service.listCases())).toHaveLength(1)
    expect(document.title).toBe(EXAMPLE_CASE_TITLE)
    expect(new Set(document.blocks.map((block) => block.type))).toEqual(new Set([
      'markdown', 'facts', 'flow', 'table', 'timeline', 'evidence', 'gallery',
    ]))
    expect(document.artifacts.map((artifact) => artifact.kind)).toEqual([
      'screenshot', 'http', 'trace', 'code',
    ])
  })
})
