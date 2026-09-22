import { caseDocumentSchema, summarizeCase, type CaseDocument } from './model.js'
import type { CaseRepository } from './repository.js'

function clone(document: CaseDocument): CaseDocument {
  return structuredClone(document)
}

export class MemoryCaseRepository implements CaseRepository {
  private readonly cases = new Map<string, CaseDocument>()
  private readonly activeCases = new Map<string, string>()

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
    this.cases.set(document.id, clone(caseDocumentSchema.parse(document)))
  }

  async getActiveCase(sessionId: string) {
    return this.activeCases.get(sessionId)
  }

  async setActiveCase(sessionId: string, caseId: string) {
    this.activeCases.set(sessionId, caseId)
  }
}
