import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  artifactSchema,
  blockSchema,
  caseDocumentSchema,
  summarizeCase,
  type Artifact,
  type Block,
  type CaseDocument,
} from '../core/model.js'
import type { CaseRepository } from '../core/repository.js'

const caseRecordSchema = caseDocumentSchema.omit({ blocks: true, artifacts: true }).extend({
  blockOrder: z.array(z.string()).default([]),
  artifactOrder: z.array(z.string()).default([]),
})
const blockRecordSchema = z.object({ caseId: z.string(), block: blockSchema })
const artifactRecordSchema = z.object({ caseId: z.string(), artifact: artifactSchema })
const sessionLinkSchema = z.object({ caseId: z.string() })

export const tracebookDomainSpec = defineDomain({
  name: 'tracebook',
  version: 1,
  layout: 'per-record',
  tables: {
    cases: domainTable<string, z.infer<typeof caseRecordSchema>>(caseRecordSchema),
    blocks: domainTable<string, z.infer<typeof blockRecordSchema>>(blockRecordSchema),
    artifacts: domainTable<string, z.infer<typeof artifactRecordSchema>>(artifactRecordSchema),
    session_links: domainTable<string, z.infer<typeof sessionLinkSchema>>(sessionLinkSchema),
  },
})

type TracebookDomain = Domain<typeof tracebookDomainSpec>

const compoundKey = (caseId: string, itemId: string) => `${caseId}\u0000${itemId}`

export class DshCaseRepository implements CaseRepository {
  private constructor(private readonly domain: TracebookDomain) {}

  static async open(facility: DomainFacility) {
    return new DshCaseRepository(await facility.open(tracebookDomainSpec))
  }

  async close() {
    await this.domain.close()
  }

  async list() {
    const cases = this.domain.table('cases')
    const blocks = this.domain.table('blocks')
    const artifacts = this.domain.table('artifacts')
    const blockCounts = new Map<string, number>()
    const artifactCounts = new Map<string, number>()
    for (const [, record] of blocks.entries()) blockCounts.set(record.caseId, (blockCounts.get(record.caseId) ?? 0) + 1)
    for (const [, record] of artifacts.entries()) artifactCounts.set(record.caseId, (artifactCounts.get(record.caseId) ?? 0) + 1)
    return [...cases.entries()]
      .map(([, record]) => ({
        ...summarizeCase({
          ...record,
          blocks: [],
          artifacts: [],
        }),
        blockCount: blockCounts.get(record.id) ?? 0,
        artifactCount: artifactCounts.get(record.id) ?? 0,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(caseId: string): Promise<CaseDocument | undefined> {
    const record = this.domain.table('cases').get(caseId)
    if (!record) return undefined
    const blockMap = new Map<string, Block>()
    const artifactMap = new Map<string, Artifact>()
    for (const [, value] of this.domain.table('blocks').entries()) {
      if (value.caseId === caseId) blockMap.set(value.block.id, value.block)
    }
    for (const [, value] of this.domain.table('artifacts').entries()) {
      if (value.caseId === caseId) artifactMap.set(value.artifact.id, value.artifact)
    }
    const blocks = [
      ...record.blockOrder.flatMap((id) => blockMap.has(id) ? [blockMap.get(id)!] : []),
      ...[...blockMap.values()].filter((block) => !record.blockOrder.includes(block.id)),
    ]
    const artifacts = [
      ...record.artifactOrder.flatMap((id) => artifactMap.has(id) ? [artifactMap.get(id)!] : []),
      ...[...artifactMap.values()].filter((artifact) => !record.artifactOrder.includes(artifact.id)),
    ]
    const { blockOrder: _blockOrder, artifactOrder: _artifactOrder, ...caseRecord } = record
    return caseDocumentSchema.parse({ ...caseRecord, blocks, artifacts })
  }

  async put(document: CaseDocument) {
    const parsed = caseDocumentSchema.parse(document)
    const { blocks, artifacts, ...record } = parsed
    await this.domain.table('cases').put(parsed.id, {
      ...record,
      blockOrder: blocks.map((block) => block.id),
      artifactOrder: artifacts.map((artifact) => artifact.id),
    })

    const blockTable = this.domain.table('blocks')
    const desiredBlocks = new Set(blocks.map((block) => compoundKey(parsed.id, block.id)))
    for (const [key, value] of blockTable.entries()) {
      if (value.caseId === parsed.id && !desiredBlocks.has(key)) await blockTable.delete(key)
    }
    for (const block of blocks) await blockTable.put(compoundKey(parsed.id, block.id), { caseId: parsed.id, block })

    const artifactTable = this.domain.table('artifacts')
    const desiredArtifacts = new Set(artifacts.map((artifact) => compoundKey(parsed.id, artifact.id)))
    for (const [key, value] of artifactTable.entries()) {
      if (value.caseId === parsed.id && !desiredArtifacts.has(key)) await artifactTable.delete(key)
    }
    for (const artifact of artifacts) {
      await artifactTable.put(compoundKey(parsed.id, artifact.id), { caseId: parsed.id, artifact })
    }
  }

  async getActiveCase(sessionId: string) {
    return this.domain.table('session_links').get(sessionId)?.caseId
  }

  async setActiveCase(sessionId: string, caseId: string) {
    await this.domain.table('session_links').put(sessionId, { caseId })
  }
}
