import type { FunctionComponent } from 'react'
import { VIEWER_PATH, viewerUrl } from './wire'

export interface TracebookTabProps {
  /** Current session, supplied by the session-scoped tab seat. */
  sessionId?: string
}

/**
 * The Tracebook tab body: the Vue SPA in a same-origin frame.
 *
 * The Viewer stays a standalone application — this plugin does not embed it in
 * the React tree — so the tab is only a viewport for it. The session travels in
 * the URL, and every follow-up travels back over `postMessage`.
 */
export const TracebookTab: FunctionComponent<TracebookTabProps> = ({ sessionId }) => (
  <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#ffffff' }}>
    <iframe
      title="Tracebook"
      src={viewerUrl(sessionId)}
      data-tracebook-viewer={VIEWER_PATH}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#ffffff' }}
    />
  </div>
)
