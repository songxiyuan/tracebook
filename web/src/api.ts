import type { CaseDocument, CaseRevisionSnapshot, CaseRevisionSummary, CaseSummary } from '../../src/core/model'

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`/tracebook/api${path}`, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    const detail = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
    throw new Error(detail?.error?.message ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export async function listCases() {
  return (await request<{ cases: CaseSummary[] }>('/cases')).cases
}

export function getCase(caseId: string) {
  return request<CaseDocument>(`/cases/${encodeURIComponent(caseId)}`)
}

export interface SessionCases {
  sessionId: string
  activeCaseId?: string
  cases: CaseSummary[]
}

/** Resolve a DSH session to its linked cases; the Viewer never guesses between several. */
export function sessionCases(sessionId: string) {
  return request<SessionCases>(`/sessions/${encodeURIComponent(sessionId)}/cases`)
}

export interface CaseRevisionProbe {
  caseId: string
  revision: number
  status: CaseDocument['status']
  updatedAt: string
}

/** Cheap revision probe for the update notice. */
export function getRevision(caseId: string) {
  return request<CaseRevisionProbe>(`/cases/${encodeURIComponent(caseId)}/revision`)
}

export function listRevisions(caseId: string) {
  return request<{ caseId: string; revisions: CaseRevisionSummary[] }>(`/cases/${encodeURIComponent(caseId)}/revisions`)
}

export function getRevisionSnapshot(caseId: string, revision: number) {
  return request<CaseRevisionSnapshot>(`/cases/${encodeURIComponent(caseId)}/revisions/${revision}`)
}

export function artifactUrl(artifactId: string) {
  return `/tracebook/api/artifacts/${encodeURIComponent(artifactId)}`
}
