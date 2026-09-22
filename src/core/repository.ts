import type { CaseDocument, CaseRevisionSnapshot, CaseRevisionSummary, CaseSummary } from './model.js'

export interface CaseRepository {
  list(): Promise<CaseSummary[]>
  get(caseId: string): Promise<CaseDocument | undefined>
  put(document: CaseDocument): Promise<void>
  getActiveCase(sessionId: string): Promise<string | undefined>
  setActiveCase(sessionId: string, caseId: string): Promise<void>
  /** Every stored revision of one case, newest first. */
  listRevisions(caseId: string): Promise<CaseRevisionSummary[]>
  /** One stored revision of one case, blocks included. */
  getRevision(caseId: string, revision: number): Promise<CaseRevisionSnapshot | undefined>
}
