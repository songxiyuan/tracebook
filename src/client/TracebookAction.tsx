import { useCallback, useEffect, useRef, useState, type FunctionComponent } from 'react'
import type { ClientContext } from './context'
import { TRACEBOOK_TAB_KIND, viewerUrl } from './wire'

export interface TracebookActionProps {
  /** Current session, supplied by the session-scoped header seat. */
  sessionId?: string
}

type Phase = 'idle' | 'busy' | 'failed'

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  padding: '0 9px',
  border: '1px solid transparent',
  borderRadius: 7,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
}

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#22d3ee',
  boxShadow: '0 0 0 3px rgba(34,211,238,.14)',
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  zIndex: 50,
  marginTop: 6,
  width: 240,
  padding: '10px 12px',
  border: '1px solid #334155',
  borderRadius: 6,
  background: '#0f172a',
  boxShadow: '0 18px 48px rgba(2,6,23,.5)',
  fontSize: 11,
  lineHeight: 1.5,
}

/**
 * The DSH-native Tracebook entry in the conversation header.
 *
 * It resolves the session's case through the Viewer (which reads the Host's
 * `sourceSessions`), so the button never needs a second business write path and
 * never guesses between several linked cases. Opening uses the right Sidebar;
 * when that is unavailable the same-origin URL opens in a browser tab instead.
 */
export function createTracebookAction(ctx: ClientContext): FunctionComponent<TracebookActionProps> {
  return function TracebookAction({ sessionId }) {
    const [phase, setPhase] = useState<Phase>('idle')
    const [linked, setLinked] = useState(false)
    const [copied, setCopied] = useState(false)
    const timer = useRef<number | undefined>(undefined)

    useEffect(() => {
      let cancelled = false
      if (!sessionId) { setLinked(false); return }
      void fetch(`/tracebook/api/sessions/${encodeURIComponent(sessionId)}/cases`, { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() as Promise<{ cases?: unknown[] }> : undefined))
        .then((data) => { if (!cancelled && data) setLinked((data.cases?.length ?? 0) > 0) })
        .catch(() => { if (!cancelled) setLinked(false) })
      return () => { cancelled = true }
    }, [sessionId])

    useEffect(() => () => { if (timer.current !== undefined) window.clearTimeout(timer.current) }, [])

    const open = useCallback(() => {
      setCopied(false)
      setPhase('busy')
      const openInBrowser = () => {
        // Same-origin URL, so the Viewer resolves the session itself.
        const opened = window.open(viewerUrl(sessionId), '_blank', 'noopener')
        setPhase(opened ? 'idle' : 'failed')
      }
      // The right Sidebar service may be absent in this surface; when its
      // tab-open path is unavailable, fall back to a browser tab rather than
      // silently doing nothing.
      if (typeof ctx.sidebarRight?.openTab !== 'function') {
        openInBrowser()
      } else {
        try {
          ctx.sidebarRight.openTab(TRACEBOOK_TAB_KIND)
          setPhase('idle')
        } catch {
          openInBrowser()
        }
      }
      if (timer.current !== undefined) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setPhase((current) => (current === 'busy' ? 'idle' : current)), 400)
    }, [sessionId])

    const copyLink = useCallback(() => {
      const url = new URL(viewerUrl(sessionId), window.location.origin).toString()
      void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => setCopied(false))
    }, [sessionId])

    return (
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          type="button"
          style={{ ...buttonStyle, opacity: phase === 'busy' ? 0.6 : 1 }}
          title={linked ? 'Tracebook — 当前会话已关联 Case' : 'Tracebook'}
          aria-label="Tracebook"
          disabled={phase === 'busy'}
          onClick={open}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3 2.5h7.5A2.5 2.5 0 0 1 13 5v8.5H5.5A2.5 2.5 0 0 1 3 11V2.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M6 6h4M6 8.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          Tracebook
          {linked && <span style={dotStyle} aria-hidden="true" />}
        </button>
        {phase === 'failed' && (
          <span style={popoverStyle} role="status">
            无法打开 Tracebook。
            <button type="button" style={{ ...buttonStyle, padding: 0, color: '#22d3ee' }} onClick={copyLink}>
              {copied ? '已复制链接' : '复制链接'}
            </button>
          </span>
        )}
      </span>
    )
  }
}
