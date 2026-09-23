import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lookup } from 'mime-types'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { TracebookError } from '../core/errors.js'
import type { Artifact, CaseDocument } from '../core/model.js'
import type { TracebookService } from '../core/service.js'

// tsup emits this module as dist/index.js and Vite emits the SPA beside it as
// dist/web/. Resolve from the published runtime location, not the source tree.
const defaultWebRoot = fileURLToPath(new URL('./web/', import.meta.url))

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(response.req.method === 'HEAD' ? undefined : body)
}

function sendError(response: ServerResponse, error: unknown) {
  if (error instanceof TracebookError) {
    const status = error.code === 'NOT_FOUND'
      || error.code === 'ARTIFACT_NOT_FOUND'
      || error.code === 'REVISION_NOT_FOUND' ? 404
      : error.code === 'CONFLICT' ? 409
        : 400
    sendJson(response, status, { error: { code: error.code, message: error.message } })
    return
  }
  sendJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected Tracebook error' } })
}

async function streamFile(
  response: ServerResponse,
  path: string,
  method: string,
  cacheControl: string,
  contentType?: string,
) {
  const info = await stat(path)
  if (!info.isFile()) return false
  response.writeHead(200, {
    // A validated `mimeType` on the artifact record wins over sniffing the
    // on-disk extension, so `trace.txt` declared as application/json is served
    // as JSON rather than text/plain.
    'content-type': contentType || lookup(path) || 'application/octet-stream',
    'content-length': info.size,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  })
  if (method === 'HEAD') response.end()
  else createReadStream(path).pipe(response)
  return true
}

/**
 * Shared artifact response for both the global and case-scoped routes: an
 * inline content-disposition, the sandbox CSP that keeps Agent-written bytes
 * from executing in the DSH origin, and the validated `mimeType` handed to
 * `streamFile`.
 */
async function serveArtifact(response: ServerResponse, method: string, artifact: Artifact, path: string) {
  response.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(artifact.name ?? artifact.id)}`)
  // Artifact bytes are Agent-written and may come from an external capture, so
  // an SVG/HTML opened directly must not execute script in the DSH origin. A
  // sandbox CSP forces a unique origin (no scripts, no same-origin access)
  // while still letting images and text render inline.
  response.setHeader('content-security-policy', 'sandbox; default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'; media-src \'self\'')
  await streamFile(response, path, method, 'private, max-age=300', artifact.mimeType)
}

/**
 * Client-facing view of a case document. `artifact.path` is a server-side
 * absolute filesystem location; it is server-only and must never reach the
 * client, so strip it from every artifact before serializing (P0-6). The
 * stored model is unchanged.
 */
function publicCaseDocument(document: CaseDocument) {
  return {
    ...document,
    artifacts: document.artifacts.map(({ path: _path, ...artifact }) => artifact),
  }
}

async function handleApi(pathname: string, request: IncomingMessage, response: ServerResponse, service: TracebookService) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }
  if (pathname === '/tracebook/api/cases') {
    sendJson(response, 200, { cases: await service.listCases() })
    return
  }
  const sessionMatch = pathname.match(/^\/tracebook\/api\/sessions\/([^/]+)\/cases$/)
  if (sessionMatch) {
    sendJson(response, 200, await service.sessionCases(decodeURIComponent(sessionMatch[1]!)))
    return
  }
  const revisionListMatch = pathname.match(/^\/tracebook\/api\/cases\/([^/]+)\/revisions$/)
  if (revisionListMatch) {
    sendJson(response, 200, await service.revisions(decodeURIComponent(revisionListMatch[1]!)))
    return
  }
  const revisionMatch = pathname.match(/^\/tracebook\/api\/cases\/([^/]+)\/revisions\/(\d+)$/)
  if (revisionMatch) {
    sendJson(response, 200, await service.revisionSnapshot(
      decodeURIComponent(revisionMatch[1]!),
      Number(revisionMatch[2]),
    ))
    return
  }
  const revisionProbeMatch = pathname.match(/^\/tracebook\/api\/cases\/([^/]+)\/revision$/)
  if (revisionProbeMatch) {
    sendJson(response, 200, await service.revision(decodeURIComponent(revisionProbeMatch[1]!)))
    return
  }
  const caseMatch = pathname.match(/^\/tracebook\/api\/cases\/([^/]+)(?:\/blocks)?$/)
  if (caseMatch) {
    const document = await service.requireCase(decodeURIComponent(caseMatch[1]!))
    if (pathname.endsWith('/blocks')) sendJson(response, 200, { blocks: document.blocks })
    else sendJson(response, 200, publicCaseDocument(document))
    return
  }
  const scopedArtifactMatch = pathname.match(/^\/tracebook\/api\/cases\/([^/]+)\/artifacts\/([^/]+)$/)
  if (scopedArtifactMatch) {
    const { artifact, path } = await service.resolveArtifact(
      decodeURIComponent(scopedArtifactMatch[2]!),
      decodeURIComponent(scopedArtifactMatch[1]!),
    )
    await serveArtifact(response, request.method, artifact, path)
    return
  }
  const artifactMatch = pathname.match(/^\/tracebook\/api\/artifacts\/([^/]+)$/)
  if (artifactMatch) {
    const { artifact, path } = await service.resolveArtifact(decodeURIComponent(artifactMatch[1]!))
    await serveArtifact(response, request.method, artifact, path)
    return
  }
  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'API route not found' } })
}

async function handleStatic(pathname: string, request: IncomingMessage, response: ServerResponse, webRoot: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }
  const relative = pathname.replace(/^\/tracebook\/?/, '')
  const root = resolve(webRoot)
  const candidate = resolve(root, relative || 'index.html')
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end()
    return
  }
  try {
    if (relative && extname(relative) && await streamFile(response, candidate, request.method, 'public, max-age=31536000, immutable')) return
    const indexPath = resolve(root, 'index.html')
    const body = await readFile(indexPath)
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.byteLength,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') response.writeHead(404).end()
    else throw error
  }
}

export function registerHttpRoutes(
  ctx: Context,
  service: TracebookService,
  webRoot = defaultWebRoot,
) {
  // `webServer` is the current DSH service key. The published rc.1 type package
  // still calls the same route registry `httpServer`, so keep a compatibility
  // fallback until the next public package catches up with the documented API.
  const host = (ctx as Context & {
    webServer?: { register(route: WebRoute): () => void }
    httpServer?: { register(route: WebRoute): () => void }
  }).webServer ?? (ctx as Context & { httpServer?: { register(route: WebRoute): () => void } }).httpServer
  if (!host) throw new Error('Tracebook requires the DSH webServer service')
  return host.register({
    kind: 'prefix',
    path: '/tracebook',
    async handler(request: IncomingMessage, response: ServerResponse) {
      try {
        const url = new URL(request.url ?? '/', 'http://tracebook.local')
        if (url.pathname.startsWith('/tracebook/api/')) {
          await handleApi(url.pathname, request, response, service)
        } else {
          await handleStatic(url.pathname, request, response, webRoot)
        }
      } catch (error) {
        sendError(response, error)
      }
    },
  })
}
