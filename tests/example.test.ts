import { describe, expect, it } from 'vitest'
import { MetadataOnlyArtifactStore } from '../src/core/artifact-store.js'
import { MemoryCaseRepository } from '../src/core/memory-repository.js'
import { TracebookService } from '../src/core/service.js'
import { matchHarEntries } from '../src/core/har.js'
import { EXAMPLE_CASE_TITLE, EXAMPLE_HAR_DOCUMENT, seedExampleCase } from '../src/example.js'

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
      'screenshot', 'http', 'trace', 'code', 'har',
    ])
  })

  it('projects the api block into Agent context with its timing provenance', async () => {
    const service = new TracebookService(new MemoryCaseRepository(), new MetadataOnlyArtifactStore())
    const caseId = await seedExampleCase(service)
    const { context } = await service.context({ caseId })

    expect(context).toContain('POST /api/slides/generate')
    expect(context).toContain('[slo=200ms]')
    expect(context).toContain('trace p95=138ms n=12 err=0.0%')
    // Rate and errors travel with the percentile, so latency is never read alone.
    expect(context).toContain('log p95=46ms n=240 err=2.1%')
    // Inferred timing must stay labelled in Context, never blurred into a measurement.
    expect(context).toContain('[estimated p50=30ms]')
  })

  it('gives every har-sourced endpoint a HAR artifact with at least one matching entry', async () => {
    const service = new TracebookService(new MemoryCaseRepository(), new MetadataOnlyArtifactStore())
    const caseId = await seedExampleCase(service)
    const document = await service.requireCase(caseId)
    const block = document.blocks.find((entry) => entry.id === 'api-list')
    if (block?.type !== 'api') throw new Error('expected the seeded api block')

    const harSourced = block.endpoints.filter((endpoint) => endpoint.timing?.source === 'har')
    expect(harSourced.length).toBeGreaterThan(0)

    for (const endpoint of harSourced) {
      const artifactId = endpoint.timing?.artifactRef
      expect(artifactId, `${endpoint.id} must cite its HAR artifact`).toBeDefined()
      // A cited artifact that is missing, or holds no matching request, would
      // silently downgrade the Viewer to the summary bar in every case.
      const artifact = document.artifacts.find((entry) => entry.id === artifactId)
      expect(artifact?.kind, `${endpoint.id} cites a non-HAR artifact`).toBe('har')
      expect(
        matchHarEntries(EXAMPLE_HAR_DOCUMENT, endpoint.method, endpoint.path).length,
        `${endpoint.id} has no matching HAR entry`,
      ).toBeGreaterThan(0)
    }
  })
})
