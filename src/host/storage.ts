import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  artifactSchema,
  blockSchema,
  caseDocumentSchema,
  caseRevisionSnapshotSchema,
  revisionSnapshotOf,
  summarizeCase,
  summarizeRevision,
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
const revisionRecordSchema = z.object({
  caseId: z.string(),
  revision: z.number().int().positive(),
  snapshot: caseRevisionSnapshotSchema,
})

export const tracebookDomainSpec = defineDomain({
  name: 'tracebook',
  version: 1,
  layout: 'per-record',
  tables: {
    cases: domainTable<string, z.infer<typeof caseRecordSchema>>(caseRecordSchema),
    blocks: domainTable<string, z.infer<typeof blockRecordSchema>>(blockRecordSchema),
    artifacts: domainTable<string, z.infer<typeof artifactRecordSchema>>(artifactRecordSchema),
    session_links: domainTable<string, z.infer<typeof sessionLinkSchema>>(sessionLinkSchema),
    revisions: domainTable<string, z.infer<typeof revisionRecordSchema>>(revisionRecordSchema),
  },
})

type TracebookDomain = Domain<typeof tracebookDomainSpec>

const compoundKey = (caseId: string, itemId: string) =>
  Buffer.from(JSON.stringify([caseId, itemId])).toString('base64url')

/**
 * P1-8: one poisoned record must not 500 a whole read. Reads validate each
 * block/artifact/revision record on its own and skip (never throw on) a record
 * that fails, logging enough to find it. A `console.warn` is deliberate — the
 * repository has no `ctx` logger in hand and a warning is the right severity for
 * "recovered by skipping".
 */
function warnSkippedRecord(caseId: string, key: string, kind: string, error: z.ZodError): void {
  const issue = error.issues[0]
  const detail = issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid record'
  console.warn(`[tracebook] skipped malformed ${kind} record for case ${caseId} (key=${key}): ${detail}`)
}

/**
 * P1-8: version-upgrade seam. The domain spec is `version: 1`, so today this is
 * an identity map. When the stored shape changes, bump the domain `version`, add
 * the old number to `compatibleVersions`, and translate legacy records to the
 * current shape here before they are validated — keeping migration in one place
 * instead of scattering per-field fallbacks through the read paths.
 */
function migrateRecord<T>(_fromVersion: number, record: T): T {
  return record
}

/**
 * Case store over the DSH domain backend.
 *
 * The backend gives one per-domain write chain (each write awaits durability,
 * then mutates memory, then emits) but has no multi-record transaction and no
 * reload/reopen primitive: a process only sees its own writes plus whatever
 * `open()` loaded. TRUE cross-process live visibility is therefore not solvable
 * here and is out of scope — this class scopes itself to intra-process
 * atomicity and torn-state avoidance (see `get`/`put`).
 */
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
    // P1-8: skip a malformed case record rather than letting it take the whole
    // listing down; the other cases still list.
    const summaries: Array<ReturnType<typeof summarizeCase> & { blockCount: number; artifactCount: number }> = []
    for (const [key, record] of cases.entries()) {
      const parsed = caseRecordSchema.safeParse(migrateRecord(tracebookDomainSpec.version, record))
      if (!parsed.success) {
        warnSkippedRecord(key, key, 'case', parsed.error)
        continue
      }
      summaries.push({
        ...summarizeCase({ ...parsed.data, blocks: [], artifacts: [] }),
        blockCount: blockCounts.get(parsed.data.id) ?? 0,
        artifactCount: artifactCounts.get(parsed.data.id) ?? 0,
      })
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(caseId: string): Promise<CaseDocument | undefined> {
    const record = this.domain.table('cases').get(caseId)
    if (!record) return undefined
    const blockMap = new Map<string, Block>()
    const artifactMap = new Map<string, Artifact>()
    // P1-8: validate each block/artifact on its own. A single poisoned record is
    // skipped (with a warning) instead of throwing and 500-ing the whole case.
    for (const [key, value] of this.domain.table('blocks').entries()) {
      if (value.caseId !== caseId) continue
      const parsed = blockSchema.safeParse(migrateRecord(tracebookDomainSpec.version, value.block))
      if (!parsed.success) {
        warnSkippedRecord(caseId, key, 'block', parsed.error)
        continue
      }
      blockMap.set(parsed.data.id, parsed.data)
    }
    for (const [key, value] of this.domain.table('artifacts').entries()) {
      if (value.caseId !== caseId) continue
      const parsed = artifactSchema.safeParse(migrateRecord(tracebookDomainSpec.version, value.artifact))
      if (!parsed.success) {
        warnSkippedRecord(caseId, key, 'artifact', parsed.error)
        continue
      }
      artifactMap.set(parsed.data.id, parsed.data)
    }
    // The `cases` record's order arrays are the single source of truth for
    // membership: a block/artifact is visible only if the committed case lists
    // it. Records still on disk but absent from the order arrays are orphans
    // from a half-applied or superseded write and stay invisible, so a reader
    // never observes torn state. A record listed in the order array but skipped
    // above (malformed) simply drops out — the rest of the case still returns.
    const blocks = record.blockOrder.flatMap((id) => blockMap.has(id) ? [blockMap.get(id)!] : [])
    const artifacts = record.artifactOrder.flatMap((id) => artifactMap.has(id) ? [artifactMap.get(id)!] : [])
    const { blockOrder: _blockOrder, artifactOrder: _artifactOrder, ...caseRecord } = record
    return caseDocumentSchema.parse({ ...caseRecord, blocks, artifacts })
  }

  async put(document: CaseDocument) {
    const parsed = caseDocumentSchema.parse(document)
    const { blocks, artifacts, ...record } = parsed
    const blockTable = this.domain.table('blocks')
    const artifactTable = this.domain.table('artifacts')

    // Ordering rationale (P0-2/P0-3): the flip runs in three phases so a crash
    // at any point leaves a consistent case, because `get()` reads membership
    // only from the `cases` record's order arrays.
    //   (a) write every desired block/artifact record and the revision record —
    //       none is visible until the commit lists it, so a crash here leaves
    //       the OLD case fully intact;
    //   (b) write the `cases` record with the new order arrays — this single
    //       durable write is the atomic commit point;
    //   (c) prune block/artifact records no longer wanted — a crash between (b)
    //       and (c) leaves only invisible orphans, not torn state.
    for (const block of blocks) await blockTable.put(compoundKey(parsed.id, block.id), { caseId: parsed.id, block })
    for (const artifact of artifacts) {
      await artifactTable.put(compoundKey(parsed.id, artifact.id), { caseId: parsed.id, artifact })
    }
    await this.domain.table('revisions').put(compoundKey(parsed.id, String(parsed.revision)), {
      caseId: parsed.id,
      revision: parsed.revision,
      snapshot: revisionSnapshotOf(parsed),
    })

    await this.domain.table('cases').put(parsed.id, {
      ...record,
      blockOrder: blocks.map((block) => block.id),
      artifactOrder: artifacts.map((artifact) => artifact.id),
    })

    const desiredBlocks = new Set(blocks.map((block) => compoundKey(parsed.id, block.id)))
    for (const [key, value] of blockTable.entries()) {
      if (value.caseId === parsed.id && !desiredBlocks.has(key)) await blockTable.delete(key)
    }
    const desiredArtifacts = new Set(artifacts.map((artifact) => compoundKey(parsed.id, artifact.id)))
    for (const [key, value] of artifactTable.entries()) {
      if (value.caseId === parsed.id && !desiredArtifacts.has(key)) await artifactTable.delete(key)
    }
  }

  async getActiveCase(sessionId: string) {
    return this.domain.table('session_links').get(sessionId)?.caseId
  }

  async setActiveCase(sessionId: string, caseId: string) {
    await this.domain.table('session_links').put(sessionId, { caseId })
  }

  async listRevisions(caseId: string) {
    // P1-8: a malformed snapshot record is skipped, not fatal, so history still
    // lists every revision that parses.
    const summaries: ReturnType<typeof summarizeRevision>[] = []
    for (const [key, record] of this.domain.table('revisions').entries()) {
      if (record.caseId !== caseId) continue
      const parsed = caseRevisionSnapshotSchema.safeParse(migrateRecord(tracebookDomainSpec.version, record.snapshot))
      if (!parsed.success) {
        warnSkippedRecord(caseId, key, 'revision', parsed.error)
        continue
      }
      summaries.push(summarizeRevision(parsed.data))
    }
    return summaries.sort((a, b) => b.revision - a.revision)
  }

  async getRevision(caseId: string, revision: number) {
    const record = this.domain.table('revisions').get(compoundKey(caseId, String(revision)))
    if (record?.caseId !== caseId) return undefined
    // P1-8: a poisoned snapshot reads as "not found" (404) rather than a 500.
    const parsed = caseRevisionSnapshotSchema.safeParse(migrateRecord(tracebookDomainSpec.version, record.snapshot))
    if (!parsed.success) {
      warnSkippedRecord(caseId, compoundKey(caseId, String(revision)), 'revision', parsed.error)
      return undefined
    }
    return parsed.data
  }
}
