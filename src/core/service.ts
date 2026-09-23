import { z } from 'zod'
import {
  artifactInputSchema,
  blockSchema,
  caseDocumentSchema,
  summarizeCase,
  type ApiTiming,
  type Artifact,
  type ArtifactInput,
  type Block,
  type CaseDocument,
} from './model.js'
import type { ArtifactStore } from './artifact-store.js'
import { TracebookError } from './errors.js'
import type { CaseRepository } from './repository.js'

const openInputSchema = z.object({
  caseId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  type: z.string().optional(),
  environment: z.string().optional(),
  sourceSessionId: z.string().optional(),
}).refine((value) => value.caseId || value.title, {
  message: 'title is required when creating a case',
})

const updateInputSchema = z.object({
  caseId: z.string().trim().min(1).optional(),
  sourceSessionId: z.string().optional(),
  expectedRevision: z.number().int().positive().optional(),
  title: z.string().trim().min(1).optional(),
  type: z.string().optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
  summary: z.string().optional(),
  environment: z.string().optional(),
  upsertBlocks: z.array(blockSchema).default([]),
  artifacts: z.array(artifactInputSchema).default([]),
})

export type OpenCaseInput = z.input<typeof openInputSchema>
export type UpdateCaseInput = z.input<typeof updateInputSchema>

export interface OpenCaseResult {
  caseId: string
  summary?: string
  blocks: Array<{ id: string; type: string; title?: string }>
  revision: number
}

export interface UpdateCaseResult {
  caseId: string
  revision: number
  updatedBlockIds: string[]
  artifactIds: string[]
}

function slug(value: string) {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return normalized || 'case'
}

function createCaseId(title: string) {
  return `${slug(title)}-${crypto.randomUUID().slice(0, 8)}`
}

function toOpenResult(document: CaseDocument): OpenCaseResult {
  return {
    caseId: document.id,
    summary: document.summary,
    blocks: document.blocks.map(({ id, type, title }) => ({ id, type, title })),
    revision: document.revision,
  }
}

function searchableText(block: Block): string {
  return JSON.stringify(block).toLowerCase()
}

function compactBlock(block: Block, maxLength = 900): string {
  let content: string
  switch (block.type) {
    case 'markdown':
      content = block.content
      break
    case 'facts':
      content = block.items.map((item) => `${item.label}=${String(item.value)}`).join('; ')
      break
    case 'flow': {
      const labels = new Map(block.nodes.map((node) => [node.id, node.label]))
      content = block.edges.map((edge) =>
        `${labels.get(edge.source) ?? edge.source} -> ${labels.get(edge.target) ?? edge.target}${edge.label ? ` (${edge.label})` : ''}`,
      ).join('; ')
      break
    }
    case 'table':
      content = block.rows.slice(0, 8).map((row) =>
        block.columns.map((column) => `${column.label}=${String(row[column.key] ?? '')}`).join(', '),
      ).join('; ')
      break
    case 'timeline':
      content = block.items.map((item) => `${item.title}${item.description ? `: ${item.description}` : ''}`).join(' -> ')
      break
    case 'evidence':
      content = block.items.map((item) => `${item.title}${item.summary ? `: ${item.summary}` : ''}`).join('; ')
      break
    case 'gallery':
      content = block.items.map((item) => item.caption ?? item.artifactRef).join('; ')
      break
    case 'api':
      content = block.endpoints.slice(0, 10).map((endpoint) => {
        const response = endpoint.responses?.[0]
        const observed = timingHeadline(endpoint.timing)
        return `${endpoint.method} ${endpoint.path}${endpoint.service ? ` (${endpoint.service})` : ''}`
          + `${endpoint.summary ? `: ${endpoint.summary}` : ''}`
          + `${response ? ` -> ${response.status}` : ''}`
          + `${endpoint.expectedMs !== undefined ? ` [slo=${endpoint.expectedMs}ms]` : ''}`
          + `${observed ? ` [${observed}]` : ''}`
      }).join('; ')
      break
  }
  return content.length > maxLength ? `${content.slice(0, maxLength)}…` : content
}

/**
 * One-line timing summary for Context reads.
 *
 * The source stays in the text so a follow-up Agent never reuses an inferred
 * number as if it were measured, and the error rate rides with the percentile
 * so a latency figure is never read without its failure context.
 */
function timingHeadline(timing: ApiTiming | undefined): string | undefined {
  if (!timing) return undefined
  const primary = timing.p95 !== undefined ? `p95=${timing.p95}ms`
    : timing.p50 !== undefined ? `p50=${timing.p50}ms`
      : timing.max !== undefined ? `max=${timing.max}ms`
        : undefined
  const sample = timing.sampleSize !== undefined ? ` n=${timing.sampleSize}` : ''
  const errors = timing.errorCount !== undefined && timing.sampleSize !== undefined
    ? ` err=${errorRatePercent(timing.errorCount, timing.sampleSize)}%`
    : ''
  if (!primary) return `${timing.source}${sample}${errors}`
  return `${timing.source} ${primary}${sample}${errors}`
}

function errorRatePercent(errorCount: number, sampleSize: number): string {
  return ((errorCount / sampleSize) * 100).toFixed(1)
}

export class TracebookService {
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly repository: CaseRepository,
    private readonly artifactStore: ArtifactStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  listCases() {
    return this.repository.list()
  }

  /**
   * Resolve one DSH session to its cases without a second write path: the link
   * is read from the same `sourceSessions` the Agent tools already maintain,
   * and the active case from the same `session_links` row `tracebook_open`
   * writes. The Viewer never guesses when several cases are linked.
   */
  async sessionCases(sessionId: string) {
    const cases = (await this.repository.list()).filter((summary) => summary.sourceSessions.includes(sessionId))
    const activeCaseId = await this.repository.getActiveCase(sessionId)
    return {
      sessionId,
      activeCaseId: activeCaseId && cases.some((summary) => summary.id === activeCaseId) ? activeCaseId : undefined,
      cases,
    }
  }

  /** Cheap revision probe for the Viewer's update notice; never returns the document body. */
  async revision(caseId: string) {
    const document = await this.requireCase(caseId)
    return {
      caseId: document.id,
      revision: document.revision,
      status: document.status,
      updatedAt: document.updatedAt,
    }
  }

  async revisions(caseId: string) {
    await this.requireCase(caseId)
    return { caseId, revisions: await this.repository.listRevisions(caseId) }
  }

  async revisionSnapshot(caseId: string, revision: number) {
    await this.requireCase(caseId)
    const snapshot = await this.repository.getRevision(caseId, revision)
    if (!snapshot) throw new TracebookError('REVISION_NOT_FOUND', `Revision not found: ${caseId}@${revision}`)
    return snapshot
  }

  async getCase(caseId: string) {
    return this.repository.get(caseId)
  }

  async requireCase(caseId: string) {
    const document = await this.repository.get(caseId)
    if (!document) throw new TracebookError('NOT_FOUND', `Case not found: ${caseId}`)
    return document
  }

  private serialize<T>(caseId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(caseId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.queues.set(caseId, next)
    void next.finally(() => {
      if (this.queues.get(caseId) === next) this.queues.delete(caseId)
    }).catch(() => undefined)
    return next
  }

  async open(input: OpenCaseInput): Promise<OpenCaseResult> {
    const parsed = openInputSchema.parse(input)
    if (parsed.caseId) {
      const existing = await this.requireCase(parsed.caseId)
      if (parsed.sourceSessionId) {
        await this.linkSession(existing, parsed.sourceSessionId)
        await this.repository.setActiveCase(parsed.sourceSessionId, existing.id)
      }
      return toOpenResult((await this.repository.get(existing.id)) ?? existing)
    }

    const title = parsed.title as string
    const timestamp = this.now().toISOString()
    const document = caseDocumentSchema.parse({
      id: createCaseId(title),
      title,
      type: parsed.type,
      status: 'active',
      environment: parsed.environment,
      blocks: [],
      artifacts: [],
      sourceSessions: parsed.sourceSessionId ? [parsed.sourceSessionId] : [],
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await this.repository.put(document)
    if (parsed.sourceSessionId) await this.repository.setActiveCase(parsed.sourceSessionId, document.id)
    return toOpenResult(document)
  }

  private async linkSession(document: CaseDocument, sessionId: string) {
    if (document.sourceSessions.includes(sessionId)) return
    const linked = {
      ...document,
      sourceSessions: [...document.sourceSessions, sessionId],
      revision: document.revision + 1,
      updatedAt: this.now().toISOString(),
    }
    await this.repository.put(caseDocumentSchema.parse(linked))
  }

  async update(input: UpdateCaseInput): Promise<UpdateCaseResult> {
    const parsed = updateInputSchema.parse(input)
    const caseId = parsed.caseId ?? (parsed.sourceSessionId
      ? await this.repository.getActiveCase(parsed.sourceSessionId)
      : undefined)
    if (!caseId) {
      throw new TracebookError('INVALID_INPUT', 'caseId is required when the session has no active case')
    }

    return this.serialize(caseId, async () => {
      const current = await this.requireCase(caseId)
      if (parsed.expectedRevision && current.revision !== parsed.expectedRevision) {
        throw new TracebookError(
          'CONFLICT',
          `Revision conflict: expected ${parsed.expectedRevision}, current ${current.revision}`,
        )
      }

      const timestamp = this.now().toISOString()
      const blocks = [...current.blocks]
      const positions = new Map(blocks.map((block, index) => [block.id, index]))
      for (const rawBlock of parsed.upsertBlocks) {
        const block = blockSchema.parse({ ...rawBlock, updatedAt: timestamp })
        const index = positions.get(block.id)
        if (index === undefined) {
          positions.set(block.id, blocks.length)
          blocks.push(block)
        } else {
          blocks[index] = block
        }
      }

      const savedArtifacts: Artifact[] = []
      for (const rawArtifact of parsed.artifacts as ArtifactInput[]) {
        savedArtifacts.push(await this.artifactStore.save(caseId, rawArtifact))
      }
      const artifactPositions = new Map(current.artifacts.map((artifact, index) => [artifact.id, index]))
      const artifacts = [...current.artifacts]
      for (const artifact of savedArtifacts) {
        const index = artifactPositions.get(artifact.id)
        if (index === undefined) {
          artifactPositions.set(artifact.id, artifacts.length)
          artifacts.push(artifact)
        } else {
          artifacts[index] = artifact
        }
      }

      const sourceSessions = parsed.sourceSessionId && !current.sourceSessions.includes(parsed.sourceSessionId)
        ? [...current.sourceSessions, parsed.sourceSessionId]
        : current.sourceSessions
      const nextTitle = parsed.title ?? current.title
      const nextType = parsed.type ?? current.type
      const nextStatus = parsed.status ?? current.status
      const nextSummary = parsed.summary ?? current.summary
      const nextEnvironment = parsed.environment ?? current.environment

      // P1-2: short-circuit a pure no-op so history is not littered with empty
      // revisions. Freshly saved artifacts always differ (their `createdAt` is
      // new), so any call carrying artifacts is a change; block re-sends only
      // touch a volatile `updatedAt`, so blocks are compared with that field
      // dropped from the JSON signature — a byte-identical re-send is a no-op,
      // real content edits still register.
      const blockSignature = (list: Block[]) =>
        JSON.stringify(list, (key, value) => (key === 'updatedAt' ? undefined : value))
      const unchanged = savedArtifacts.length === 0
        && sourceSessions.length === current.sourceSessions.length
        && nextTitle === current.title
        && nextType === current.type
        && nextStatus === current.status
        && nextSummary === current.summary
        && nextEnvironment === current.environment
        && blockSignature(blocks) === blockSignature(current.blocks)
        && JSON.stringify(artifacts) === JSON.stringify(current.artifacts)
      if (unchanged) {
        return {
          caseId,
          revision: current.revision,
          updatedBlockIds: parsed.upsertBlocks.map((block) => block.id),
          artifactIds: savedArtifacts.map((artifact) => artifact.id),
        }
      }

      const updated = caseDocumentSchema.parse({
        ...current,
        title: nextTitle,
        type: nextType,
        status: nextStatus,
        summary: nextSummary,
        environment: nextEnvironment,
        blocks,
        artifacts,
        sourceSessions,
        revision: current.revision + 1,
        updatedAt: timestamp,
      })
      await this.repository.put(updated)
      if (parsed.sourceSessionId) await this.repository.setActiveCase(parsed.sourceSessionId, caseId)
      return {
        caseId,
        revision: updated.revision,
        updatedBlockIds: parsed.upsertBlocks.map((block) => block.id),
        artifactIds: savedArtifacts.map((artifact) => artifact.id),
      }
    })
  }

  async context(input: { caseId?: string; sourceSessionId?: string; query?: string; maxBlocks?: number }) {
    const caseId = input.caseId ?? (input.sourceSessionId
      ? await this.repository.getActiveCase(input.sourceSessionId)
      : undefined)
    if (!caseId) throw new TracebookError('INVALID_INPUT', 'caseId is required when the session has no active case')
    const document = await this.requireCase(caseId)
    const query = input.query?.trim().toLowerCase()
    const maxBlocks = Math.min(Math.max(input.maxBlocks ?? 8, 1), 20)
    const blocks = (query
      ? document.blocks.filter((block) => searchableText(block).includes(query))
      : document.blocks
    ).slice(0, maxBlocks)
    const lines = [
      `Case: ${document.title} (${document.id})`,
      `Status: ${document.status}; revision=${document.revision}${document.environment ? `; environment=${document.environment}` : ''}`,
      '',
      'Summary:',
      document.summary || '(No summary yet)',
      '',
      query ? `Relevant blocks for "${input.query}":` : 'Blocks:',
      ...(blocks.length
        ? blocks.map((block) => `- ${block.id} [${block.type}]${block.title ? ` ${block.title}` : ''}: ${compactBlock(block)}`)
        : ['- No matching blocks']),
    ]
    return {
      caseId,
      revision: document.revision,
      context: lines.join('\n'),
      matchedBlockIds: blocks.map((block) => block.id),
    }
  }

  async resolveArtifact(artifactId: string, caseId?: string): Promise<{ artifact: Artifact; path: string }> {
    // P0-7: when the caller knows the owning case, load only that case. This
    // turns an O(cases x size) global scan into an O(case size) lookup and
    // resolves the artifact within the named case, so an id that collides
    // across cases never resolves to the wrong one.
    if (caseId !== undefined) {
      const document = await this.requireCase(caseId)
      const artifact = document.artifacts.find((candidate) => candidate.id === artifactId)
      if (!artifact) throw new TracebookError('ARTIFACT_NOT_FOUND', `Artifact not found: ${artifactId}`)
      const path = await this.artifactStore.resolve(artifact)
      if (!path) throw new TracebookError('ARTIFACT_NOT_FOUND', `Artifact content not found: ${artifactId}`)
      return { artifact, path }
    }
    // Backward-compatible global scan for callers with no caseId.
    for (const summary of await this.repository.list()) {
      const document = await this.repository.get(summary.id)
      const artifact = document?.artifacts.find((candidate) => candidate.id === artifactId)
      if (!artifact) continue
      const path = await this.artifactStore.resolve(artifact)
      if (!path) throw new TracebookError('ARTIFACT_NOT_FOUND', `Artifact content not found: ${artifactId}`)
      return { artifact, path }
    }
    throw new TracebookError('ARTIFACT_NOT_FOUND', `Artifact not found: ${artifactId}`)
  }
}
