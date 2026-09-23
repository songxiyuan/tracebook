import { useCallback, useState, type FunctionComponent } from 'react'
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
 * the URL, and every follow-up travels back over `postMessage`. A load failure
 * must not leave a blank white frame, so it surfaces an error with a retry that
 * remounts the iframe.
 */
export const TracebookTab: FunctionComponent<TracebookTabProps> = ({ sessionId }) => {
  const [failed, setFailed] = useState(false)
  // Bumping the key remounts the iframe, which forces a fresh load on retry.
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setFailed(false)
    setAttempt((value) => value + 1)
  }, [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: '#ffffff' }}>
      {failed ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#334155',
            fontSize: 13,
          }}
        >
          <span>无法加载 Tracebook Viewer。</span>
          <button
            type="button"
            onClick={retry}
            style={{
              height: 30,
              padding: '0 14px',
              border: '1px solid #334155',
              borderRadius: 7,
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            重试
          </button>
        </div>
      ) : (
        <iframe
          key={attempt}
          title="Tracebook"
          src={viewerUrl(sessionId)}
          data-tracebook-viewer={VIEWER_PATH}
          onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#ffffff' }}
        />
      )}
    </div>
  )
}
