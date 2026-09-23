import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { MetadataOnlyArtifactStore } from '../src/core/artifact-store.js'
import { caseDocumentSchema, type CaseDocument } from '../src/core/model.js'
import { TracebookService } from '../src/core/service.js'
import { DshCaseRepository } from '../src/host/storage.js'

/**
 * A conforming filesystem `KvFacet` backend over a REAL temp directory.
 *
 * The shipped json/sqlite backends are not published as installable packages
 * here (they live in the DSH host runtime) and the domain package exposes no
 * standalone "open a facility over a temp dir" helper, so we register this
 * small backend to drive the REAL `DomainFacility` / `DomainImpl` write chain —
 * the exact code the plugin runs in production. Each unit persists as one JSON
 * document; `loadAll` reads it back and `putRecord`/`deleteRecord` rewrite it
 * durably. It deliberately adds no reload-into-a-fresh-process primitive (the
 * package has none), so true cross-process live visibility stays out of scope.
 */
class JsonKvUnit implements KvUnit {
  private readonly tables = new Map<string, Map<string, unknown>>()
  private globalValue: unknown = null

  constructor(private readonly file: string, tableNames: readonly string[]) {
    for (const name of tableNames) this.tables.set(name, new Map())
  }

  async load() {
    if (!existsSync(this.file)) return
    const raw = JSON.parse(await readFile(this.file, 'utf8')) as {
      tables?: Record<string, Record<string, unknown>>
      global?: unknown
    }
    for (const [table, records] of Object.entries(raw.tables ?? {})) {
      this.tables.set(table, new Map(Object.entries(records)))
    }
    this.globalValue = raw.global ?? null
  }

  async loadAll() {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: this.globalValue }
  }

  private async flush() {
    await writeFile(this.file, JSON.stringify(await this.loadAll()))
  }

  async putRecord(table: string, key: string, value: unknown) {
    let records = this.tables.get(table)
    if (!records) {
      records = new Map()
      this.tables.set(table, records)
    }
    records.set(key, value)
    await this.flush()
  }

  async deleteRecord(table: string, key: string) {
    this.tables.get(table)?.delete(key)
    await this.flush()
  }

  async setGlobal(value: unknown) {
    this.globalValue = value
    await this.flush()
  }

  async close() {}
}

class JsonKvBackend implements StorageBackend {
  constructor(private readonly root: string) {}

  readonly kv = {
    open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      const unit = new JsonKvUnit(join(this.root, `${descriptor.name}.json`), descriptor.tables)
      await unit.load()
      return unit
    },
  }

  async close() {}
}

const facilities: DomainFacility[] = []

async function openRepository() {
  const root = await mkdtemp(join(tmpdir(), 'tracebook-domain-'))
  const backend = new JsonKvBackend(root)
  // Minimal Context the real DomainFacility/DomainImpl touch: backend lookup,
  // change emission, and a logger. Everything below is the published domain
  // layer running for real.
  const ctx = {
    storage: { backend: { get: () => backend } },
    emit: () => true,
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  } as unknown as Context
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  facilities.push(facility)
  return DshCaseRepository.open(facility)
}

function makeCase(overrides: Partial<CaseDocument> & { id: string }): CaseDocument {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return caseDocumentSchema.parse({
    title: 'Case',
    status: 'active',
    blocks: [],
    artifacts: [],
    sourceSessions: [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  })
}

afterEach(async () => {
  await Promise.all(facilities.splice(0).map((facility) => facility.closeAll()))
})

describe('DshCaseRepository over a real DomainFacility', () => {
  it('round-trips a created case and preserves block/artifact order', async () => {
    const repository = await openRepository()
    await repository.put(makeCase({
      id: 'case-1',
      blocks: [
        { id: 'b2', type: 'markdown', content: 'two' },
        { id: 'b1', type: 'markdown', content: 'one' },
      ],
      artifacts: [
        { id: 'a2', caseId: 'case-1', kind: 'log', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a1', caseId: 'case-1', kind: 'log', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    }))

    const document = await repository.get('case-1')
    expect(document?.blocks.map((block) => block.id)).toEqual(['b2', 'b1'])
    expect(document?.artifacts.map((artifact) => artifact.id)).toEqual(['a2', 'a1'])
  })

  it('replaces an updated block in place and accumulates revision history', async () => {
    const repository = await openRepository()
    await repository.put(makeCase({
      id: 'case-2',
      blocks: [
        { id: 'overview', type: 'markdown', content: 'Initial' },
        { id: 'flow', type: 'flow', direction: 'TB', nodes: [{ id: 'n', label: 'N' }], edges: [] },
      ],
    }))
    await repository.put(makeCase({
      id: 'case-2',
      revision: 2,
      blocks: [
        { id: 'overview', type: 'markdown', content: 'Expanded' },
        { id: 'flow', type: 'flow', direction: 'TB', nodes: [{ id: 'n', label: 'N' }], edges: [] },
      ],
    }))

    const document = await repository.get('case-2')
    expect(document?.blocks.map((block) => block.id)).toEqual(['overview', 'flow'])
    expect(document?.blocks[0]).toMatchObject({ content: 'Expanded' })
    expect((await repository.listRevisions('case-2')).map((item) => item.revision)).toEqual([2, 1])
  })

  it('makes pruned blocks invisible once the case no longer lists them', async () => {
    const repository = await openRepository()
    await repository.put(makeCase({
      id: 'case-3',
      blocks: [
        { id: 'keep', type: 'markdown', content: 'stay' },
        { id: 'drop', type: 'markdown', content: 'gone' },
      ],
    }))
    await repository.put(makeCase({
      id: 'case-3',
      revision: 2,
      blocks: [{ id: 'keep', type: 'markdown', content: 'stay' }],
    }))

    const document = await repository.get('case-3')
    expect(document?.blocks.map((block) => block.id)).toEqual(['keep'])
  })

  it('does not add a revision for a no-op update', async () => {
    const repository = await openRepository()
    let tick = 0
    const service = new TracebookService(
      repository,
      new MetadataOnlyArtifactStore(),
      () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    )
    const { caseId } = await service.open({ title: 'No-op probe' })
    const first = await service.update({ caseId, upsertBlocks: [{ id: 'b1', type: 'markdown', content: 'same' }] })
    expect(first.revision).toBe(2)

    const again = await service.update({ caseId, upsertBlocks: [{ id: 'b1', type: 'markdown', content: 'same' }] })
    expect(again.revision).toBe(2)
    expect((await service.revisions(caseId)).revisions.map((item) => item.revision)).toEqual([2, 1])
  })
})
