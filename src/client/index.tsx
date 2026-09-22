/**
 * Thin DSH browser-side plugin: a Tracebook entry in the conversation header,
 * a right-Sidebar tab that hosts the same-origin Vue Viewer, and the
 * `Ask about this` bridge back into the conversation input.
 *
 * Everything else stays where it belongs: cases and storage in the Host plugin,
 * the document UI in the Vue SPA. This half holds no business state — it opens
 * a URL and places text.
 */
import type { ClientContext } from './context'
import { createTracebookAction } from './TracebookAction'
import { TracebookTab } from './TracebookTab'
import { insertFollowUp } from './bridge'
import { parseAskMessage, TRACEBOOK_TAB_ID, TRACEBOOK_TAB_KIND } from './wire'

/** Browser services this plugin composes: the slot registry, the right Sidebar, and the conversation input. */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'conversation', 'sessions']

export function apply(ctx: ClientContext) {
  // Stage one: the page type. `openTab('tracebook')` names it, the guide lists it.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TRACEBOOK_TAB_ID,
    kind: TRACEBOOK_TAB_KIND,
    title: () => 'Tracebook',
    guide: [{
      order: 80,
      title: () => 'Tracebook',
      description: () => '当前会话的调查记录',
    }],
  }), 'tracebook: tab type')

  // Stage two: the body, under the same identity. Wait for the seat's
  // declaration so plugin load order never matters.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TRACEBOOK_TAB_ID,
  }, TracebookTab)), 'tracebook: tab body')

  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'tracebook',
    order: 20,
  }, createTracebookAction(ctx))), 'tracebook: header entry')

  // The follow-up bridge: the Viewer composes the context, this side only
  // places it in the composer. Drafts are appended to, never sent. The result
  // goes back to the frame so the Viewer can say what actually happened.
  ctx.effect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const message = parseAskMessage(event.data)
      if (!message) return
      const outcome = insertFollowUp(ctx, message.sessionId, message.text)
      const source = event.source as Window | null
      source?.postMessage({
        source: 'tracebook',
        type: 'ask-result',
        ok: outcome.ok,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      }, window.location.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, 'tracebook: follow-up bridge')
}
