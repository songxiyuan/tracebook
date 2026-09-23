import { ref } from 'vue'

const STORAGE_KEY = 'tracebook:session'

/**
 * The DSH session whose case the Viewer should surface.
 *
 * It arrives in the URL because the launcher (the thin DSH client plugin, or a
 * bookmarked link) is the only side that knows the active session; it is
 * remembered for the tab so moving between the list and a case does not drop
 * the linkage. The Viewer still treats it as a hint: the case relationship is
 * always resolved through the Host API's `sourceSessions`.
 */
function readInitialSession(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('session')?.trim()
  if (fromUrl) {
    try { window.sessionStorage.setItem(STORAGE_KEY, fromUrl) } catch { /* storage may be unavailable */ }
    return fromUrl
  }
  try { return window.sessionStorage.getItem(STORAGE_KEY) ?? '' } catch { return '' }
}

export const sessionId = ref(readInitialSession())

export function rememberSession(value: string | undefined) {
  const next = value?.trim() ?? ''
  if (next === sessionId.value) return
  sessionId.value = next
  try {
    if (next) window.sessionStorage.setItem(STORAGE_KEY, next)
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch { /* storage may be unavailable */ }
}

/** True while the Viewer runs inside the DSH right Sidebar rather than a standalone tab. */
export const embedded = window.parent !== window

export interface AskSelection {
  /** What the user selected inside a block. */
  type: 'node' | 'evidence' | 'api'
  id: string
  label?: string
}

/** The context envelope an `Ask about this` follow-up carries back to the conversation. */
export interface AskEnvelope {
  caseId: string
  caseTitle: string
  revision: number
  blockId: string
  selection: AskSelection
  question: string
}

export interface AskMessage {
  source: 'tracebook'
  type: 'ask'
  /** Session the Viewer belongs to, so the client plugin targets the right composer. */
  sessionId?: string
  envelope: AskEnvelope
  /** Ready-to-insert prompt text; the embedding client only places it in the composer. */
  text: string
}

/**
 * Hand one follow-up to the embedding DSH client plugin. The Viewer organizes
 * context only: it never sends the message, and returns false when it is not
 * embedded so the caller can fall back to copying.
 */
export function sendAsk(message: Omit<AskMessage, 'source' | 'type' | 'sessionId'>): boolean {
  if (!embedded) return false
  window.parent.postMessage(
    { source: 'tracebook', type: 'ask', sessionId: sessionId.value || undefined, ...message },
    window.location.origin,
  )
  return true
}

export interface AskResult {
  ok: boolean
  reason?: string
}

/**
 * Observe the embedding client's acknowledgement. The Viewer only claims the
 * follow-up reached the composer after this says so; a failure keeps the
 * context available for the copy fallback.
 */
export function onAskResult(handler: (result: AskResult) => void): () => void {
  const listener = (event: MessageEvent) => {
    // Trust only same-origin messages from our own parent frame; the source
    // check alone would accept a cross-origin frame posing as the parent.
    if (event.origin !== window.location.origin) return
    if (event.source !== window.parent) return
    const data = event.data as { source?: unknown; type?: unknown; ok?: unknown; reason?: unknown } | undefined
    if (!data || data.source !== 'tracebook' || data.type !== 'ask-result') return
    handler({ ok: data.ok === true, reason: typeof data.reason === 'string' ? data.reason : undefined })
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
