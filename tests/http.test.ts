import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { MetadataOnlyArtifactStore } from '../src/core/artifact-store.js'
import { MemoryCaseRepository } from '../src/core/memory-repository.js'
import { TracebookService } from '../src/core/service.js'
import { registerHttpRoutes } from '../src/host/http.js'

/** Mount the plugin's routes on a real HTTP server, exactly as the DSH web host does. */
async function startServer(service: TracebookService) {
  const routes: WebRoute[] = []
  const ctx = {
    webServer: { register: (route: WebRoute) => { routes.push(route); return () => undefined } },
  } as unknown as Context
  registerHttpRoutes(ctx, service, '/nonexistent-tracebook-web-root')
  const server = createServer((request, response) => {
    void routes[0]!.handler(request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}` }
}

describe('tracebook http routes', () => {
  let service: TracebookService
  let server: ReturnType<typeof createServer>
  let base = ''
  let caseId = ''

  beforeAll(async () => {
    service = new TracebookService(new MemoryCaseRepository(), new MetadataOnlyArtifactStore())
    const created = await service.open({ title: 'PPT generation', type: 'exploration', sourceSessionId: 'session-a' })
    caseId = created.caseId
    await service.update({
      caseId,
      summary: 'Page and API confirmed.',
      upsertBlocks: [{ id: 'flow', type: 'flow', direction: 'TB', nodes: [{ id: 'page', label: 'PPT Page' }], edges: [] }],
    })
    await service.update({
      caseId,
      upsertBlocks: [{
        id: 'flow', type: 'flow', direction: 'TB',
        nodes: [{ id: 'page', label: 'PPT Page' }, { id: 'api', label: 'POST /slides/generate' }],
        edges: [{ id: 'page-api', source: 'page', target: 'api' }],
      }],
    })
    const started = await startServer(service)
    server = started.server
    base = started.base
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('lists cases with their session links', async () => {
    const response = await fetch(`${base}/tracebook/api/cases`)
    expect(response.status).toBe(200)
    const body = await response.json() as { cases: Array<{ id: string; sourceSessions: string[] }> }
    expect(body.cases).toHaveLength(1)
    expect(body.cases[0]).toMatchObject({ id: caseId, sourceSessions: ['session-a'] })
  })

  it('resolves a session to its active and linked cases', async () => {
    const linked = await fetch(`${base}/tracebook/api/sessions/session-a/cases`).then((r) => r.json())
    expect(linked).toMatchObject({ sessionId: 'session-a', activeCaseId: caseId })
    expect((linked as { cases: unknown[] }).cases).toHaveLength(1)

    const other = await fetch(`${base}/tracebook/api/sessions/session-b/cases`).then((r) => r.json())
    expect(other).toMatchObject({ sessionId: 'session-b', cases: [] })
    expect((other as { activeCaseId?: string }).activeCaseId).toBeUndefined()
  })

  it('serves the cheap revision probe, the history list, and one snapshot', async () => {
    const probe = await fetch(`${base}/tracebook/api/cases/${caseId}/revision`).then((r) => r.json())
    expect(probe).toMatchObject({ caseId, revision: 3, status: 'active' })

    const history = await fetch(`${base}/tracebook/api/cases/${caseId}/revisions`).then((r) => r.json()) as {
      revisions: Array<{ revision: number; blockCount: number }>
    }
    expect(history.revisions.map((item) => item.revision)).toEqual([3, 2, 1])

    const snapshot = await fetch(`${base}/tracebook/api/cases/${caseId}/revisions/1`).then((r) => r.json()) as {
      blocks: unknown[]
    }
    expect(snapshot.blocks).toHaveLength(0)

    const missing = await fetch(`${base}/tracebook/api/cases/${caseId}/revisions/99`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'REVISION_NOT_FOUND' } })
  })

  it('keeps writes out of the read API and reports unknown routes', async () => {
    const write = await fetch(`${base}/tracebook/api/cases`, { method: 'POST' })
    expect(write.status).toBe(405)

    const unknown = await fetch(`${base}/tracebook/api/unknown`)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('maps an unresolvable artifact to 404 ARTIFACT_NOT_FOUND, never a bare 500', async () => {
    const missing = await fetch(`${base}/tracebook/api/artifacts/does-not-exist`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'ARTIFACT_NOT_FOUND' } })
  })
})
