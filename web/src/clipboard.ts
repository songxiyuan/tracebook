/**
 * Small clipboard + link helpers shared by the Viewer. Copy actions degrade
 * gracefully: they resolve to `false` when the Clipboard API is unavailable or
 * denied, so a caller can show a fallback hint instead of throwing.
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Absolute URL for a same-origin path (or a `#hash` appended to the current page). */
export function absoluteUrl(pathOrHash: string): string {
  if (pathOrHash.startsWith('#')) return `${location.origin}${location.pathname}${location.search}${pathOrHash}`
  return `${location.origin}${pathOrHash}`
}

/** Deep link to a specific block within the current case (its scroll anchor). */
export function blockLink(blockId: string): string {
  return absoluteUrl(`#block-${blockId}`)
}

export interface CurlParts {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
}

/** Build a copy-pasteable, single-line-per-flag cURL command. */
export function buildCurl({ method, url, headers = {}, body }: CurlParts): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  const lines = [`curl -X ${method.toUpperCase()} ${quote(url)}`]
  for (const [name, value] of Object.entries(headers)) lines.push(`  -H ${quote(`${name}: ${value}`)}`)
  if (body) lines.push(`  -d ${quote(body)}`)
  return lines.join(' \\\n')
}
