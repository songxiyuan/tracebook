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
      'markdown', 'facts', 'flow', 'table', 'timeline', 'evidence', 'gallery', 'api',
    ]))
    expect(document.artifacts.map((artifact) => artifact.kind)).toEqual([
      'screenshot', 'http', 'trace', 'code',
    ])
  })

  it('projects the api block into Agent context with its timing provenance', async () => {
    const service = new TracebookService(new MemoryCaseRepository(), new MetadataOnlyArtifactStore())
    const caseId = await seedExampleCase(service)
    const { context } = await service.context({ caseId })

    expect(context).toContain('POST /api/slides/generate')
    expect(context).toContain('trace p50=85ms')
    expect(context).toContain('log p95=46ms n=240')
    // Inferred timing must stay labelled in Context, never blurred into a measurement.
    expect(context).toContain('[estimated p50=30ms]')
  })
})
