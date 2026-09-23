import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileArtifactStore } from '../src/host/artifact-store.js'

describe('FileArtifactStore', () => {
  it('writes content under a sanitized case directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracebook-test-'))
    const store = new FileArtifactStore(root)
    const artifact = await store.save('../case', {
      id: '../trace',
      kind: 'trace',
      mimeType: 'application/json',
      name: 'trace.json',
      contentText: '{"ok":true}',
    })
    const path = await store.resolve(artifact)
    expect(path?.startsWith(root)).toBe(true)
    expect(await readFile(path!, 'utf8')).toBe('{"ok":true}')
  })

  it('rejects a path input when no ingest root is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracebook-test-'))
    const store = new FileArtifactStore(root)
    await expect(store.save('case', { kind: 'log', path: 'anything.log' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('ingests an in-root path and rejects escapes when an ingest root is configured', async () => {
    const storeRoot = await mkdtemp(join(tmpdir(), 'tracebook-store-'))
    const ingestRoot = await mkdtemp(join(tmpdir(), 'tracebook-ingest-'))
    await writeFile(join(ingestRoot, 'evidence.log'), 'captured bytes', 'utf8')
    const store = new FileArtifactStore(storeRoot, ingestRoot)

    const artifact = await store.save('case', { id: 'ev', kind: 'log', path: 'evidence.log' })
    const path = await store.resolve(artifact)
    // The ingested bytes are copied into the store's own root (self-contained).
    expect(path?.startsWith(storeRoot)).toBe(true)
    expect(await readFile(path!, 'utf8')).toBe('captured bytes')

    // A traversal escape and an absolute out-of-root path are both refused.
    await expect(store.save('case', { kind: 'log', path: '../escape.log' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(store.save('case', { kind: 'log', path: '/etc/hostname' }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('unlinks a stored file on remove and ignores a missing one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tracebook-test-'))
    const store = new FileArtifactStore(root)
    const artifact = await store.save('case', { id: 'gone', kind: 'log', contentText: 'bye' })
    expect(await store.resolve(artifact)).toBeDefined()
    await store.remove(artifact)
    expect(await store.resolve(artifact)).toBeUndefined()
    // A second removal is a no-op rather than an error.
    await expect(store.remove(artifact)).resolves.toBeUndefined()
  })
})
