import type { ClientContext } from './context'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface BridgeOutcome {
  ok: boolean
  /** Why the insertion did not happen; the Viewer shows a copy fallback. */
  reason?: 'no-session' | 'no-scope' | 'unavailable' | 'failed'
}

/**
 * Place one follow-up into a DSH conversation input.
 *
 * This is the whole client-side responsibility of `Ask about this`: the text is
 * appended to whatever the user already drafted (never replacing it), and the
 * message stays a draft — the user still presses send. Nothing here writes to a
 * Tracebook case; that remains the Agent's `tracebook_update`.
 */
export function insertFollowUp(ctx: ClientContext, sessionId: string | undefined, text: string): BridgeOutcome {
  try {
    const sessions = ctx.sessions
    const conversation = ctx.conversation
    if (!sessions || !conversation) return { ok: false, reason: 'unavailable' }
    const target = (sessionId ?? sessions.list.getSnapshot().current) as SessionId | undefined
    if (!target) return { ok: false, reason: 'no-session' }
    const actx = sessions.scope(target)
    if (!actx) return { ok: false, reason: 'no-scope' }
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(draft.trim() ? `${draft.replace(/\s+$/, '')}\n\n${text}` : text)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
