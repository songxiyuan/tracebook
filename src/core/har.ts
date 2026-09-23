/**
 * HAR 1.2 matching: pick the captured requests that belong to one endpoint.
 *
 * Pure and dependency-free on purpose. Deciding *which* captured request a
 * reader means when they look at an endpoint is domain logic, not painting, so
 * it lives in Core and the Viewer only decides how to draw the result. A
 * renderer must never be the thing that decides what a HAR contains.
 *
 * A HAR document is the frozen de-facto capture format (HAR 1.2); the W3C
 * draft of the same name was abandoned, so the phase vocabulary here follows
 * the community spec.
 */

/** The parts of a HAR entry that matching reads; a real entry carries far more. */
export interface HarEntryView {
  startedDateTime?: string
  time?: number
  request?: { method?: string; url?: string }
  response?: { status?: number }
  timings?: Record<string, number | undefined>
}

/** The parts of a HAR document that matching reads. */
export interface HarDocumentView {
  log: { version?: string; entries: HarEntryView[]; pages?: unknown[] }
}

/**
 * Parse artifact text as HAR.
 *
 * Anything that is not a HAR document returns `undefined` rather than throwing,
 * so a caller falls back to the summary phases instead of painting a chart over
 * data it did not understand.
 */
export function parseHarDocument(text: string): HarDocumentView | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const log = (value as { log?: unknown }).log
  if (typeof log !== 'object' || log === null) return undefined
  if (!Array.isArray((log as { entries?: unknown }).entries)) return undefined
  return value as HarDocumentView
}

/**
 * Compile an endpoint path template into a matcher.
 *
 * `:id` and any other `:name` segment becomes exactly one path segment, so a
 * template written the way the API declares it matches the concrete URLs a
 * capture actually holds. A trailing slash is tolerated.
 */
export function pathTemplateRegExp(template: string): RegExp {
  const segments = template.replace(/\/+$/, '').split('/')
  const pattern = segments.map((segment) => {
    if (segment.startsWith(':')) return '[^/]+'
    if (segment === '*') return '.*'
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('/')
  return new RegExp(`^${pattern}/?$`)
}

/**
 * Pathname of a captured request URL.
 *
 * Falls back to string splitting when the URL will not parse, because a HAR
 * exported from a proxy can legitimately hold a relative or malformed URL and
 * dropping the whole entry over it would hide real evidence.
 */
export function harEntryPath(entry: HarEntryView): string | undefined {
  const url = entry.request?.url
  if (typeof url !== 'string' || url === '') return undefined
  try {
    return new URL(url).pathname
  } catch {
    const path = url.split(/[?#]/)[0] ?? ''
    return path.startsWith('/') ? path : undefined
  }
}

/** Captured requests belonging to one endpoint, oldest first. */
export function matchHarEntries(
  document: HarDocumentView,
  method: string,
  template: string,
): HarEntryView[] {
  const matchesTemplate = pathTemplateRegExp(template)
  const wanted = method.toUpperCase()
  return document.log.entries
    .filter((entry) => {
      const entryMethod = entry.request?.method
      if (typeof entryMethod !== 'string' || entryMethod.toUpperCase() !== wanted) return false
      const path = harEntryPath(entry)
      return path !== undefined && matchesTemplate.test(path)
    })
    .sort((a, b) => (a.startedDateTime ?? '').localeCompare(b.startedDateTime ?? ''))
}

/**
 * A HAR document holding only the matched entries.
 *
 * Page timings are dropped: they describe a whole page load, so leaving them
 * next to one endpoint's requests would attribute unrelated events to it.
 */
export function harDocumentForEntries(
  document: HarDocumentView,
  entries: HarEntryView[],
): HarDocumentView {
  return { log: { version: document.log.version, entries } }
}
