import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { MetadataOnlyArtifactStore } from '../src/core/artifact-store.js'
import { MemoryCaseRepository } from '../src/core/memory-repository.js'
import { TracebookService } from '../src/core/service.js'
import { registerHttpRoutes } from '../src/host/http.js'

const builtWebRoot = fileURLToPath(new URL('../dist/web/', import.meta.url))
const builtEntry = fileURLToPath(new URL('../dist/web/index.html', import.meta.url))

/**
 * The served Viewer is a build artifact, and nothing else in the suite checks
 * it: `http.test.ts` mounts the routes against a web root that deliberately
 * does not exist. These run against `dist/web`, so `verify` builds before it
 * tests, and they skip on a clean checkout rather than failing one.
 *
 * The host bundle (`dist/index.js`) is intentionally not imported here: its
 * DSH runtime dependencies are not installed in this repository, by design.
 */
describe.skipIf(!existsSync(builtEntry))('built viewer', () => {
  let server: ReturnType<typeof createServer>
  let base = ''

  beforeAll(async () => {
    const service = new TracebookService(new MemoryCaseRepository(), new MetadataOnlyArtifactStore())
    const routes: WebRoute[] = []
    const ctx = {
      webServer: { register: (route: WebRoute) => { routes.push(route); return () => undefined } },
    } as unknown as Context
    registerHttpRoutes(ctx, service, builtWebRoot)
    server = createServer((request, response) => { void routes[0]!.handler(request, response) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('serves the built entry', async () => {
    const response = await fetch(`${base}/tracebook/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<div id="app">')
    expect(html).toMatch(/\/tracebook\/assets\/index-[\w-]+\.js/)
  })

  it('serves every asset the entry references', async () => {
    const html = await (await fetch(`${base}/tracebook/`)).text()
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!)
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      // The entry emits root-relative paths that already include the mount
      // point, so the reference is requested as written.
      const response = await fetch(`${base}${ref}`)
      expect(response.status, ref).toBe(200)
      expect(Number(response.headers.get('content-length')), ref).toBeGreaterThan(0)
    }
  })

  it('falls back to the entry for a client-side route', async () => {
    const response = await fetch(`${base}/tracebook/cases/some-case`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<div id="app">')
  })
})
