import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { extension } from 'mime-types'
import { artifactInputSchema, type Artifact, type ArtifactInput } from '../core/model.js'
import type { ArtifactStore } from '../core/artifact-store.js'

function isInside(root: string, candidate: string) {
  const normalizedRoot = resolve(root)
  const normalizedCandidate = resolve(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
}

function assertInside(root: string, candidate: string) {
  if (!isInside(root, candidate)) {
    throw new Error('Resolved artifact path escapes the artifact root')
  }
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async save(caseId: string, rawInput: ArtifactInput): Promise<Artifact> {
    const input = artifactInputSchema.parse(rawInput)
    const id = input.id ?? crypto.randomUUID()
    const bytes = input.contentBase64
      ? Buffer.from(input.contentBase64, 'base64')
      : input.contentText !== undefined
        ? Buffer.from(input.contentText, 'utf8')
        : undefined
    let path: string | undefined
    if (bytes) {
      const suppliedExtension = input.name ? extname(input.name) : ''
      const inferredExtension = input.mimeType ? extension(input.mimeType) : false
      const suffix = suppliedExtension || (inferredExtension ? `.${inferredExtension}` : '')
      path = join(resolve(this.root), safeSegment(caseId), `${safeSegment(id)}${safeSegment(suffix)}`)
      assertInside(this.root, path)
      await mkdir(dirname(path), { recursive: true })
      const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
      await writeFile(temporaryPath, bytes, { flag: 'wx' })
      await rename(temporaryPath, path)
    }
    return {
      id,
      caseId,
      kind: input.kind,
      mimeType: input.mimeType,
      name: input.name,
      path,
      size: bytes?.byteLength,
      summary: input.summary,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    }
  }

  async resolve(artifact: Artifact) {
    if (!artifact.path) return undefined
    // A path that escapes the root or no longer exists on disk (root moved,
    // machine changed, file pruned) resolves to "not found" rather than a raw
    // 500: the caller turns `undefined` into ARTIFACT_NOT_FOUND (404).
    if (!isInside(this.root, artifact.path)) return undefined
    try {
      const info = await stat(artifact.path)
      if (!info.isFile()) return undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    return artifact.path
  }
}
