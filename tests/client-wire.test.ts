import { describe, expect, it } from 'vitest'
import { parseAskMessage, viewerUrl } from '../src/client/wire.js'

describe('tracebook client wire', () => {
  it('builds same-origin viewer urls without hard-coding a host', () => {
    expect(viewerUrl()).toBe('/tracebook/')
    expect(viewerUrl('session a/b')).toBe('/tracebook/?session=session%20a%2Fb')
  })

  it('accepts a well-formed follow-up message', () => {
    const message = parseAskMessage({
      source: 'tracebook',
      type: 'ask',
      sessionId: 'session-a',
      envelope: { caseId: 'case-1', blockId: 'flow', selection: { type: 'node', id: 'svc' } },
      text: 'Tracebook 追问',
    })
    expect(message).toMatchObject({ sessionId: 'session-a', text: 'Tracebook 追问' })
  })

  it('rejects anything that is not ours or carries no text', () => {
    expect(parseAskMessage(undefined)).toBeUndefined()
    expect(parseAskMessage('ask')).toBeUndefined()
    expect(parseAskMessage({ source: 'other', type: 'ask', text: 'hi', envelope: { caseId: 'a', blockId: 'b' } })).toBeUndefined()
    expect(parseAskMessage({ source: 'tracebook', type: 'ask', text: '   ', envelope: { caseId: 'a', blockId: 'b' } })).toBeUndefined()
    expect(parseAskMessage({ source: 'tracebook', type: 'ask', text: 'hi', envelope: { caseId: 'a' } })).toBeUndefined()
  })
})
