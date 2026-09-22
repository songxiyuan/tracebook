/**
 * Wire contract between the Tracebook Viewer (Vue, running same-origin in an
 * iframe) and this thin DSH client plugin.
 *
 * The Viewer owns the follow-up's meaning: it composes the context envelope and
 * the ready-to-send text. This side only places that text in the conversation
 * input; it never sends, and it never interprets the selection.
 */

/** Registration identity of the right-Sidebar tab type (stage one and two share it). */
export const TRACEBOOK_TAB_ID = 'dsh-tracebook'
/** Page kind the header entry opens and the tab body is registered under. */
export const TRACEBOOK_TAB_KIND = 'tracebook'
/** Message channel marker; a message without it is not ours. */
export const ASK_MESSAGE_SOURCE = 'tracebook'

/** Same-origin Viewer path served by the Tracebook Host plugin. */
export const VIEWER_PATH = '/tracebook/'

export interface AskSelection {
  type: 'node' | 'evidence'
  id: string
  label?: string
}

export interface AskEnvelope {
  caseId: string
  caseTitle?: string
  revision?: number
  blockId: string
  selection: AskSelection
  question?: string
}

export interface AskMessage {
  source: typeof ASK_MESSAGE_SOURCE
  type: 'ask'
  /** DSH session the Viewer belongs to; absent means "route to the current one". */
  sessionId?: string
  envelope: AskEnvelope
  text: string
}

/**
 * Viewer URL for one session. Relative on purpose: the DSH page's own origin
 * (loopback or a Tailscale/reverse-proxy host) is reused, never hard-coded.
 */
export function viewerUrl(sessionId?: string): string {
  return sessionId ? `${VIEWER_PATH}?session=${encodeURIComponent(sessionId)}` : VIEWER_PATH
}

/**
 * Validate one `postMessage` payload. Only the shape is checked; the caller
 * has already matched the origin.
 */
export function parseAskMessage(data: unknown): AskMessage | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const value = data as Record<string, unknown>
  if (value.source !== ASK_MESSAGE_SOURCE || value.type !== 'ask') return undefined
  if (typeof value.text !== 'string' || value.text.trim() === '') return undefined
  if (typeof value.envelope !== 'object' || value.envelope === null) return undefined
  const envelope = value.envelope as Record<string, unknown>
  if (typeof envelope.caseId !== 'string' || typeof envelope.blockId !== 'string') return undefined
  return {
    source: ASK_MESSAGE_SOURCE,
    type: 'ask',
    sessionId: typeof value.sessionId === 'string' && value.sessionId ? value.sessionId : undefined,
    envelope: value.envelope as AskEnvelope,
    text: value.text,
  }
}
