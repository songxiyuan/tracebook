import {
  caseDocumentSchema,
  revisionSnapshotOf,
  summarizeCase,
  summarizeRevision,
  type CaseDocument,
  type CaseRevisionSnapshot,
} from './model.js'
import type { CaseRepository } from './repository.js'

function clone<T>(value: T): T {
  return structuredClone(value)
}

export class MemoryCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, CaseDocument>()
  private readonly activeCases = new Map<string, string>()
  private readonly revisions = new Map<string, Map<number, CaseRevisionSnapshot>>()

  async list() {
    return [...this.cases.values()]
      .map(summarizeCase)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(caseId: string) {
    const document = this.cases.get(caseId)
    return document ? clone(document) : undefined
  }

  async put(document: CaseDocument) {
    const parsed = caseDocumentSchema.parse(document)
    this.cases.set(parsed.id, clone(parsed))
    const history = this.revisions.get(parsed.id) ?? new Map<number, CaseRevisionSnapshot>()
    history.set(parsed.revision, clone(revisionSnapshotOf(parsed)))
    this.revisions.set(parsed.id, history)
  }

  async getActiveCase(sessionId: string) {
    return this.activeCases.get(sessionId)
  }

  async setActiveCase(sessionId: string, caseId: string) {
    this.activeCases.set(sessionId, caseId)
  }

  async listRevisions(caseId: string) {
    return [...(this.revisions.get(caseId)?.values() ?? [])]
      .map(summarizeRevision)
      .sort((a, b) => b.revision - a.revision)
  }

  async getRevision(caseId: string, revision: number) {
    const snapshot = this.revisions.get(caseId)?.get(revision)
    return snapshot ? clone(snapshot) : undefined
  }
}
