import type { CaseDocument, CaseRevisionSnapshot, CaseRevisionSummary, CaseSummary } from '../../src/core/model'

/** A slow or hung backend should surface as a clear error, not an endless spinner. */
const DEFAULT_TIMEOUT_MS = 15000

/**
 * Shared read helper: every call gets an abort-based timeout and a single,
 * unified error surface (HTTP status, backend message, timeout, or network).
 */
async function request<T>(path: string, options: { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`/tracebook/api${path}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined
      throw new Error(detail?.error?.message ?? `Request failed (${response.status})`)
    }
    return await response.json() as T
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw reason instanceof Error ? reason : new Error(String(reason))
  } finally {
    clearTimeout(timer)
  }
}

/** The list is the entry point; retry once so a single transient failure does not strand it. */
async function requestWithRetry<T>(path: string, retries = 1): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await request<T>(path)
    } catch (reason) {
      lastError = reason
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function listCases() {
  return (await requestWithRetry<{ cases: CaseSummary[] }>('/cases')).cases
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

export function artifactUrl(artifactId: string, caseId?: string) {
  // Case-scoped path when the caller knows the owning case (avoids the global
  // artifact scan and cross-case id collisions); the legacy path stays the
  // default so existing call sites keep working unchanged.
  return caseId
    ? `/tracebook/api/cases/${encodeURIComponent(caseId)}/artifacts/${encodeURIComponent(artifactId)}`
    : `/tracebook/api/artifacts/${encodeURIComponent(artifactId)}`
}
