import { z } from 'zod'
import {
  artifactInputSchema,
  assertArtifactPayloadWithinLimits,
  blockSchema,
  caseDocumentSchema,
  MAX_ARTIFACTS_PER_UPDATE,
  MAX_UPSERT_BLOCKS,
  summarizeCase,
  type ApiTiming,
  type Artifact,
  type ArtifactInput,
  type Block,
  type CaseDocument,
} from './model.js'
import type { ArtifactStore } from './artifact-store.js'
import { diagramEdgeEndpoints, diagramNodeLabels } from './archify.js'
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
  // P1-9 / P1-12: ids to remove from the case in this same call. Deleting a
  // missing id is a no-op (see service.update).
  deleteBlockIds: z.array(z.string().trim().min(1)).default([]),
  deleteArtifactIds: z.array(z.string().trim().min(1)).default([]),
}).superRefine((value, ctx) => {
  // P1-1: reject duplicate ids inside one call. Silent last-write-wins would
  // make the upsert order load-bearing and surprise the caller.
  const seenBlockIds = new Set<string>()
  for (const block of value.upsertBlocks) {
    if (seenBlockIds.has(block.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate block id ${block.id} in upsertBlocks` })
    }
    seenBlockIds.add(block.id)
  }
  const seenArtifactIds = new Set<string>()
  for (const artifact of value.artifacts) {
    if (artifact.id === undefined) continue
    if (seenArtifactIds.has(artifact.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate artifact id ${artifact.id} in artifacts` })
    }
    seenArtifactIds.add(artifact.id)
  }
})

export type OpenCaseInput = z.input<typeof openInputSchema>
export type UpdateCaseInput = z.input<typeof updateInputSchema>

/**
 * P3-5: emitted after any write that lands a new revision for a case. It carries
 * only the identity and the new revision — never the document body — so a
 * listener re-reads through the same HTTP read path rather than getting a second
 * write channel.
 */
export interface CaseChangeEvent {
  caseId: string
  revision: number
}

export type CaseChangeListener = (event: CaseChangeEvent) => void

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
  /**
   * P1-11: non-fatal dangling-reference warnings for the resulting case, e.g. a
   * block that points at an artifact id or block id that is not present. Empty
   * when everything resolves; never a reason to reject the write.
   */
  warnings: string[]
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
      if (block.variant !== 'basic' && block.diagram) {
        const labels = diagramNodeLabels(block.diagram)
        content = diagramEdgeEndpoints(block.diagram).map((edge) =>
          `${labels.get(edge.from) ?? edge.from} -> ${labels.get(edge.to) ?? edge.to}${edge.label ? ` (${edge.label})` : ''}`,
        ).join('; ')
        break
      }
      const labels = new Map((block.nodes ?? []).map((node) => [node.id, node.label]))
      content = (block.edges ?? []).map((edge) =>
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
    case 'sequence': {
      // A stream is an open push, so it reads with a dashed arrow; sync/async
      // share the solid arrow and let the parenthesised kind tell them apart.
      // timingSource stays visible for the same evidence-first reason as `api`:
      // an inferred duration must never be mistaken for a measured one.
      const labels = new Map(block.participants.map((participant) => [participant.id, participant.label]))
      content = block.messages.map((message) => {
        const arrow = message.kind === 'stream' ? '-->' : '->'
        const from = labels.get(message.from) ?? message.from
        const to = labels.get(message.to) ?? message.to
        const meta = [
          message.kind,
          message.status !== undefined ? String(message.status) : undefined,
          message.durationMs !== undefined ? `${message.durationMs}ms` : undefined,
          message.timingSource,
        ].filter((part): part is string => part !== undefined)
        return `${from}${arrow}${to}: ${message.label} (${meta.join(',')})`
      }).join('; ')
      break
    }
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

/**
 * Surface schema validation as INVALID_INPUT (HTTP 400) instead of letting a
 * raw ZodError escape as a 500. The first issue's message is the most specific,
 * so it becomes the client-facing reason; non-Zod errors pass through unchanged.
 */
function toInvalidInput(error: unknown): TracebookError {
  if (error instanceof z.ZodError) {
    const message = error.issues[0]?.message ?? 'Invalid input'
    return new TracebookError('INVALID_INPUT', message)
  }
  throw error
}

/**
 * P1-11: a shallow scan of the known ref-bearing fields for references that do
 * not resolve inside the resulting case. Pragmatic on purpose — it walks the
 * fields that actually carry ids and reports the danglers, nothing deeper.
 */
function referenceWarnings(blocks: Block[], artifacts: Artifact[]): string[] {
  const warnings: string[] = []
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id))
  const blockIds = new Set(blocks.map((block) => block.id))
  const missingArtifact = (ref: string, where: string) => {
    if (!artifactIds.has(ref)) warnings.push(`${where} references missing artifact "${ref}"`)
  }
  const missingBlock = (ref: string, where: string) => {
    if (!blockIds.has(ref)) warnings.push(`${where} references missing block "${ref}"`)
  }
  for (const block of blocks) {
    for (const ref of block.artifactRefs ?? []) missingArtifact(ref, `Block "${block.id}"`)
    switch (block.type) {
      case 'flow':
        for (const node of block.nodes ?? []) {
          for (const ref of node.artifactRefs ?? []) missingArtifact(ref, `Flow node "${node.id}"`)
          for (const ref of node.relatedBlockIds ?? []) missingBlock(ref, `Flow node "${node.id}"`)
        }
        for (const edge of block.edges ?? []) {
          for (const ref of edge.artifactRefs ?? []) missingArtifact(ref, `Flow edge "${edge.id}"`)
          for (const ref of edge.relatedBlockIds ?? []) missingBlock(ref, `Flow edge "${edge.id}"`)
        }
        break
      case 'api':
        for (const endpoint of block.endpoints) {
          for (const ref of endpoint.artifactRefs ?? []) missingArtifact(ref, `Endpoint "${endpoint.id}"`)
          for (const ref of endpoint.relatedBlockIds ?? []) missingBlock(ref, `Endpoint "${endpoint.id}"`)
          for (const response of endpoint.responses ?? []) {
            if (response.artifactRef) missingArtifact(response.artifactRef, `Endpoint "${endpoint.id}" response ${response.status}`)
          }
          if (endpoint.timing?.artifactRef) missingArtifact(endpoint.timing.artifactRef, `Endpoint "${endpoint.id}" timing`)
        }
        break
      case 'gallery':
        for (const item of block.items) missingArtifact(item.artifactRef, `Gallery block "${block.id}"`)
        break
      case 'evidence':
        for (const item of block.items) {
          if (item.artifactRef) missingArtifact(item.artifactRef, `Evidence "${item.id}"`)
        }
        break
      case 'timeline':
        for (const item of block.items) {
          for (const ref of item.artifactRefs ?? []) missingArtifact(ref, `Timeline item "${item.title}"`)
        }
        break
      case 'sequence':
        for (const message of block.messages) {
          for (const ref of message.artifactRefs ?? []) missingArtifact(ref, `Sequence message "${message.id}"`)
        }
        break
    }
  }
  return warnings
}

export class TracebookService {
  private readonly queues = new Map<string, Promise<unknown>>()

  /**
   * P3-5: same-process change listeners. Deliberately a plain callback set, not
   * a DSH import or a Node `events` emitter — Core must stay free of DSH and of
   * transport concerns. The host layer subscribes here to push revision bumps
   * over SSE. This is intra-process only: cross-process live updates are out of
   * scope because the storage backend exposes no reload primitive (documented
   * in storage.ts), so a listener only ever sees writes made through this
   * instance.
   */
  private readonly changeListeners = new Set<CaseChangeListener>()

  constructor(
    private readonly repository: CaseRepository,
    private readonly artifactStore: ArtifactStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Subscribe to same-process case-change events; returns an unsubscribe
   * function. Fires only on writes that produce a new revision, never on the
   * no-op path.
   */
  onChange(listener: CaseChangeListener): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  /** Notify every listener; a throwing listener must not derail the write or its peers. */
  private notifyChange(event: CaseChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event)
      } catch {
        // Swallow: a subscriber's failure is its own; the write is already durable.
      }
    }
  }

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
    this.notifyChange({ caseId: document.id, revision: document.revision })
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
    this.notifyChange({ caseId: linked.id, revision: linked.revision })
  }

  async update(input: UpdateCaseInput): Promise<UpdateCaseResult> {
    let parsed: z.infer<typeof updateInputSchema>
    try {
      parsed = updateInputSchema.parse(input)
    } catch (error) {
      throw toInvalidInput(error)
    }

    // P1-6: cap array sizes so a single call cannot balloon the tool payload.
    // Reject rather than silently truncate.
    if (parsed.upsertBlocks.length > MAX_UPSERT_BLOCKS) {
      throw new TracebookError('INVALID_INPUT', `upsertBlocks exceeds the ${MAX_UPSERT_BLOCKS}-item limit`)
    }
    if (parsed.artifacts.length > MAX_ARTIFACTS_PER_UPDATE) {
      throw new TracebookError('INVALID_INPUT', `artifacts exceeds the ${MAX_ARTIFACTS_PER_UPDATE}-item limit`)
    }
    // P1-6: reject oversized or malformed inline payloads before any disk work,
    // to keep MB-scale base64 out of the model/tool path and the store.
    for (const artifact of parsed.artifacts as ArtifactInput[]) {
      assertArtifactPayloadWithinLimits(artifact)
    }

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

      // P1-9/P1-12: apply deletions before recomputing the document. Deleting a
      // missing id is a no-op; a deleted block/artifact is itself a change and
      // bumps the revision. Removed artifact files are unlinked after the write.
      const deleteBlockIds = new Set(parsed.deleteBlockIds)
      const deleteArtifactIds = new Set(parsed.deleteArtifactIds)
      const blocks = current.blocks.filter((block) => !deleteBlockIds.has(block.id))
      const artifactsToRemove: Artifact[] = current.artifacts.filter((artifact) => deleteArtifactIds.has(artifact.id))
      const artifacts = current.artifacts.filter((artifact) => !deleteArtifactIds.has(artifact.id))

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
      const artifactPositions = new Map(artifacts.map((artifact, index) => [artifact.id, index]))
      for (const artifact of savedArtifacts) {
        const index = artifactPositions.get(artifact.id)
        if (index === undefined) {
          artifactPositions.set(artifact.id, artifacts.length)
          artifacts.push(artifact)
        } else {
          // P1-12: overwriting an id with fresh bytes orphans the old file
          // unless we unlink it; queue the previous record for cleanup.
          const previous = artifacts[index]
          if (previous?.path && previous.path !== artifact.path) artifactsToRemove.push(previous)
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

      // P1-11: surface dangling references without rejecting the write.
      const warnings = referenceWarnings(blocks, artifacts)

      // P1-2: short-circuit a pure no-op so history is not littered with empty
      // revisions. Freshly saved artifacts always differ (their `createdAt` is
      // new), so any call carrying artifacts is a change; block re-sends only
      // touch a volatile `updatedAt`, so blocks are compared with that field
      // dropped from the JSON signature — a byte-identical re-send is a no-op,
      // real content edits, deletions, and overwrites still register.
      const blockSignature = (list: Block[]) =>
        JSON.stringify(list, (key, value) => (key === 'updatedAt' ? undefined : value))
      const unchanged = savedArtifacts.length === 0
        && artifactsToRemove.length === 0
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
          warnings,
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
      // P1-12: unlink orphaned files only after the revision is durable, and
      // never let a failed unlink fail the write.
      await this.removeArtifactFiles(artifactsToRemove)
      // P3-5: the revision is durable; push the bump to same-process listeners.
      this.notifyChange({ caseId, revision: updated.revision })
      return {
        caseId,
        revision: updated.revision,
        updatedBlockIds: parsed.upsertBlocks.map((block) => block.id),
        artifactIds: savedArtifacts.map((artifact) => artifact.id),
        warnings,
      }
    })
  }

  /**
   * P1-12: best-effort removal of orphaned artifact files (deleted or
   * overwritten). A store without `remove` (metadata-only) is skipped, and a
   * failed unlink is swallowed — a leftover file is harmless, but losing the
   * committed revision would not be.
   */
  private async removeArtifactFiles(artifacts: Artifact[]): Promise<void> {
    if (!this.artifactStore.remove) return
    for (const artifact of artifacts) {
      try {
        await this.artifactStore.remove(artifact)
      } catch {
        // Swallow: cleanup must never fail the surrounding write.
      }
    }
  }

  async context(input: { caseId?: string; sourceSessionId?: string; query?: string; maxBlocks?: number; blockId?: string }) {
    const caseId = input.caseId ?? (input.sourceSessionId
      ? await this.repository.getActiveCase(input.sourceSessionId)
      : undefined)
    if (!caseId) throw new TracebookError('INVALID_INPUT', 'caseId is required when the session has no active case')
    const document = await this.requireCase(caseId)

    // P1-9: single-block full read. When blockId is given, return that block's
    // complete JSON instead of the compacted listing, so a large-case successor
    // can pull exactly one block in full without re-sending the whole case.
    if (input.blockId) {
      const block = document.blocks.find((candidate) => candidate.id === input.blockId)
      if (!block) throw new TracebookError('NOT_FOUND', `Block not found: ${input.blockId}`)
      return {
        caseId,
        revision: document.revision,
        context: JSON.stringify(block, null, 2),
        matchedBlockIds: [block.id],
        block,
      }
    }

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
