import type { CaseDocument, CaseSummary } from '../../src/core/model'

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

export function artifactUrl(artifactId: string) {
  return `/tracebook/api/artifacts/${encodeURIComponent(artifactId)}`
}
