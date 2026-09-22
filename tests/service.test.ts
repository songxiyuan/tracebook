import { describe, expect, it } from 'vitest'
import { MetadataOnlyArtifactStore } from '../src/core/artifact-store.js'
import { MemoryCaseRepository } from '../src/core/memory-repository.js'
import { TracebookService } from '../src/core/service.js'

function createService() {
  let tick = 0
  return new TracebookService(
    new MemoryCaseRepository(),
    new MetadataOnlyArtifactStore(),
    () => new Date(Date.UTC(2026, 8, 22, 0, 0, tick++)),
  )
}

describe('TracebookService', () => {
  it('creates, associates, and reopens a case', async () => {
    const service = createService()
    const created = await service.open({
      title: 'PPT generation',
      type: 'exploration',
      environment: 'production',
      sourceSessionId: 'session-a',
    })

    expect(created.caseId).toMatch(/^ppt-generation-/)
    expect(created.revision).toBe(1)
    const reopened = await service.open({ caseId: created.caseId, sourceSessionId: 'session-b' })
    expect(reopened.revision).toBe(2)
    expect((await service.requireCase(created.caseId)).sourceSessions).toEqual(['session-a', 'session-b'])
  })

  it('upserts blocks in place and keeps their stable order', async () => {
    const service = createService()
    const { caseId } = await service.open({ title: 'PPT generation', sourceSessionId: 'session-a' })
    const first = await service.update({
      sourceSessionId: 'session-a',
      summary: 'Page and API confirmed.',
      upsertBlocks: [
        { id: 'overview', type: 'markdown', content: 'Initial result' },
        {
          id: 'flow', type: 'flow', direction: 'TB',
          nodes: [{ id: 'page', label: 'PPT Page' }, { id: 'api', label: 'POST /slides/generate' }],
          edges: [{ id: 'page-api', source: 'page', target: 'api' }],
        },
      ],
    })
    await service.update({
      caseId,
      expectedRevision: first.revision,
      upsertBlocks: [{ id: 'overview', type: 'markdown', content: 'Expanded result' }],
    })

    const document = await service.requireCase(caseId)
    expect(document.blocks.map((block) => block.id)).toEqual(['overview', 'flow'])
    expect(document.blocks[0]).toMatchObject({ content: 'Expanded result' })
    expect(document.revision).toBe(3)
  })

  it('rejects stale revisions without changing the case', async () => {
    const service = createService()
    const { caseId } = await service.open({ title: 'Incident' })
    await expect(service.update({ caseId, expectedRevision: 99, summary: 'stale' }))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect((await service.requireCase(caseId)).revision).toBe(1)
  })

  it('returns compact query-filtered agent context', async () => {
    const service = createService()
    const { caseId } = await service.open({ title: 'PPT generation' })
    await service.update({
      caseId,
      summary: 'Generation is asynchronous.',
      upsertBlocks: [
        { id: 'facts', type: 'facts', items: [{ label: 'worker', value: 'slide-worker' }] },
        { id: 'notes', type: 'markdown', content: 'Callback is still unknown.' },
      ],
    })
    const result = await service.context({ caseId, query: 'callback' })
    expect(result.matchedBlockIds).toEqual(['notes'])
    expect(result.context).toContain('Callback is still unknown')
    expect(result.context).not.toContain('slide-worker')
  })

  it('persists artifact metadata separately from block references', async () => {
    const service = createService()
    const { caseId } = await service.open({ title: 'Evidence' })
    const result = await service.update({
      caseId,
      artifacts: [{ id: 'log-1', kind: 'log', name: 'worker.log', contentText: 'job completed' }],
      upsertBlocks: [{
        id: 'evidence', type: 'evidence', items: [{ id: 'ev-1', kind: 'log', title: 'Worker log', artifactRef: 'log-1' }],
      }],
    })
    expect(result.artifactIds).toEqual(['log-1'])
    expect((await service.requireCase(caseId)).artifacts[0]).toMatchObject({ id: 'log-1', size: 13 })
  })

  it('resolves a session to its linked and active cases without guessing', async () => {
    const service = createService()
    const first = await service.open({ title: 'PPT generation', sourceSessionId: 'session-a' })
    await service.open({ title: 'Unrelated incident', sourceSessionId: 'session-b' })

    const linked = await service.sessionCases('session-a')
    expect(linked.activeCaseId).toBe(first.caseId)
    expect(linked.cases.map((item) => item.id)).toEqual([first.caseId])
    expect(linked.cases[0]?.sourceSessions).toEqual(['session-a'])

    const empty = await service.sessionCases('session-c')
    expect(empty.activeCaseId).toBeUndefined()
    expect(empty.cases).toEqual([])
  })

  it('keeps one revision snapshot per stored revision', async () => {
    const service = createService()
    const { caseId } = await service.open({ title: 'PPT generation' })
    await service.update({
      caseId,
      summary: 'v2',
      upsertBlocks: [{ id: 'flow', type: 'flow', nodes: [{ id: 'page', label: 'PPT Page' }], edges: [] }],
    })
    await service.update({
      caseId,
      upsertBlocks: [{ id: 'flow', type: 'flow', nodes: [{ id: 'page', label: 'PPT Page' }, { id: 'api', label: 'API' }], edges: [] }],
    })

    const history = await service.revisions(caseId)
    expect(history.revisions.map((item) => item.revision)).toEqual([3, 2, 1])
    expect(history.revisions[0]).toMatchObject({ summary: 'v2', blockCount: 1 })

    const first = await service.revisionSnapshot(caseId, 1)
    expect(first.blocks).toHaveLength(0)
    const latest = await service.revisionSnapshot(caseId, 3)
    expect(latest.blocks[0]).toMatchObject({ id: 'flow' })
    expect(latest.blocks[0]?.type === 'flow' ? latest.blocks[0].nodes : []).toHaveLength(2)

    await expect(service.revisionSnapshot(caseId, 99)).rejects.toMatchObject({ code: 'REVISION_NOT_FOUND' })
    await expect(service.revisions('missing-case')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('reports a cheap revision probe for the viewer update notice', async () => {
    const service = createService()
    const { caseId } = await service.open({ title: 'PPT generation' })
    await service.update({ caseId, summary: 'moved on' })
    expect(await service.revision(caseId)).toMatchObject({ caseId, revision: 2, status: 'active' })
  })
})
