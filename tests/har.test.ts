import { describe, expect, it } from 'vitest'
import {
  harDocumentForEntries,
  harEntryPath,
  matchHarEntries,
  parseHarDocument,
  pathTemplateRegExp,
} from '../src/core/har.js'

const har = {
  log: {
    version: '1.2',
    pages: [{ id: 'page_1', title: 'Studio' }],
    entries: [
      {
        startedDateTime: '2026-09-23T02:15:00.000Z',
        time: 58,
        request: { method: 'GET', url: 'https://studio.example.com/api/slides/jobs/job_01/download?token=abc' },
        response: { status: 302 },
      },
      {
        startedDateTime: '2026-09-23T02:16:00.000Z',
        time: 74,
        request: { method: 'GET', url: 'https://studio.example.com/api/slides/jobs/job_02/download' },
        response: { status: 302 },
      },
      {
        startedDateTime: '2026-09-23T02:14:00.000Z',
        time: 85,
        request: { method: 'POST', url: 'https://studio.example.com/api/slides/generate' },
        response: { status: 202 },
      },
    ],
  },
}

describe('har parsing', () => {
  it('parses a HAR document and rejects everything else', () => {
    expect(parseHarDocument(JSON.stringify(har))?.log.entries).toHaveLength(3)
    expect(parseHarDocument('not json')).toBeUndefined()
    expect(parseHarDocument('{"request":{},"response":{}}')).toBeUndefined()
    expect(parseHarDocument('{"log":{}}')).toBeUndefined()
  })
})

describe('path templates', () => {
  it('turns a declared path into a matcher for concrete URLs', () => {
    const matcher = pathTemplateRegExp('/api/slides/jobs/:id/download')
    expect(matcher.test('/api/slides/jobs/job_01/download')).toBe(true)
    expect(matcher.test('/api/slides/jobs/job_01/download/')).toBe(true)
    expect(matcher.test('/api/slides/jobs/job_01/download/extra')).toBe(false)
    expect(matcher.test('/api/slides/jobs/download')).toBe(false)
  })

  it('does not let regex metacharacters in a literal path match loosely', () => {
    const matcher = pathTemplateRegExp('/api/v1.0/files')
    expect(matcher.test('/api/v1.0/files')).toBe(true)
    // A '.' must be a literal dot, not "any character".
    expect(matcher.test('/api/v1x0/files')).toBe(false)
  })
})

describe('endpoint matching', () => {
  it('matches on method and path, ignoring the query string, oldest first', () => {
    const entries = matchHarEntries(har, 'get', '/api/slides/jobs/:id/download')
    expect(entries).toHaveLength(2)
    expect(entries[0]?.time).toBe(58)
    expect(entries[1]?.time).toBe(74)
  })

  it('keeps methods apart so one path cannot bleed into another', () => {
    expect(matchHarEntries(har, 'POST', '/api/slides/jobs/:id/download')).toHaveLength(0)
    expect(matchHarEntries(har, 'POST', '/api/slides/generate')).toHaveLength(1)
  })

  it('returns nothing rather than throwing when a URL cannot be read', () => {
    const broken = { log: { entries: [{ request: { method: 'GET', url: 'jobs/1/download' } }] } }
    expect(matchHarEntries(broken, 'GET', '/api/slides/jobs/:id/download')).toHaveLength(0)
    expect(harEntryPath({ request: { url: 'not a url' } })).toBeUndefined()
  })

  it('scopes the document it hands to a renderer to the matched entries', () => {
    const entries = matchHarEntries(har, 'GET', '/api/slides/jobs/:id/download')
    const scoped = harDocumentForEntries(har, entries)
    expect(scoped.log.entries).toHaveLength(2)
    // Page timings describe a whole page load; keeping them would misattribute.
    expect(scoped.log.pages).toBeUndefined()
    expect(scoped.log.version).toBe('1.2')
  })
})
