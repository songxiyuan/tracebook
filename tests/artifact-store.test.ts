import { mkdtemp, readFile } from 'node:fs/promises'
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
})
