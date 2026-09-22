import type { CaseDocument, CaseSummary } from './model.js'

export interface CaseRepository {
  list(): Promise<CaseSummary[]>
  get(caseId: string): Promise<CaseDocument | undefined>
  put(document: CaseDocument): Promise<void>
  getActiveCase(sessionId: string): Promise<string | undefined>
  setActiveCase(sessionId: string, caseId: string): Promise<void>
}
