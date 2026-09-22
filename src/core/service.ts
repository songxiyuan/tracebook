import { z } from 'zod'
import {
  artifactInputSchema,
  blockSchema,
  caseDocumentSchema,
  summarizeCase,
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
  }
  return content.length > maxLength ? `${content.slice(0, maxLength)}…` : content
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
      const updated = caseDocumentSchema.parse({
        ...current,
        title: parsed.title ?? current.title,
        type: parsed.type ?? current.type,
        status: parsed.status ?? current.status,
        summary: parsed.summary ?? current.summary,
        environment: parsed.environment ?? current.environment,
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

  async resolveArtifact(artifactId: string): Promise<{ artifact: Artifact; path: string }> {
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
