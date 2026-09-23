import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { extension } from 'mime-types'
import { artifactInputSchema, type Artifact, type ArtifactInput } from '../core/model.js'
import type { ArtifactStore } from '../core/artifact-store.js'
import { TracebookError } from '../core/errors.js'

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
  /**
   * @param root         Where the store owns and writes artifact bytes.
   * @param ingestRoot   Optional allow-list root for P1-10 `path` ingestion.
   *                     When unset, `path` inputs are rejected: the store never
   *                     reads arbitrary host paths by default.
   */
  constructor(
    private readonly root: string,
    private readonly ingestRoot?: string,
  ) {}

  async save(caseId: string, rawInput: ArtifactInput): Promise<Artifact> {
    const input = artifactInputSchema.parse(rawInput)
    const id = input.id ?? crypto.randomUUID()
    let bytes: Buffer | undefined
    let sourceExtension = ''
    if (input.path !== undefined) {
      bytes = await this.ingestFromPath(input.path)
      sourceExtension = extname(input.path)
    } else if (input.contentBase64) {
      bytes = Buffer.from(input.contentBase64, 'base64')
    } else if (input.contentText !== undefined) {
      bytes = Buffer.from(input.contentText, 'utf8')
    }
    let path: string | undefined
    if (bytes) {
      // Copy the ingested bytes into the store's own layout, so the artifact is
      // self-contained afterwards regardless of where it came from.
      const suppliedExtension = input.name ? extname(input.name) : ''
      const inferredExtension = input.mimeType ? extension(input.mimeType) : false
      const suffix = suppliedExtension || sourceExtension || (inferredExtension ? `.${inferredExtension}` : '')
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

  /**
   * P1-10: read a file from disk for ingestion, but only from inside the
   * configured allow-list root. Security rationale: an artifact `path` is
   * Agent-supplied, so it must never be able to exfiltrate arbitrary host files
   * (e.g. `/etc/passwd`, `~/.ssh/id_rsa`). We therefore (1) refuse outright when
   * no ingest root is configured, and (2) `realpath` the resolved candidate and
   * require it to stay inside the `realpath`'d root, which also defeats
   * traversal (`../`) and symlink escapes because realpath collapses both.
   */
  private async ingestFromPath(inputPath: string): Promise<Buffer> {
    if (!this.ingestRoot) {
      throw new TracebookError('INVALID_INPUT', 'path ingestion is disabled: no artifactIngestRoot is configured')
    }
    let root: string
    try {
      root = await realpath(resolve(this.ingestRoot))
    } catch {
      throw new TracebookError('INVALID_INPUT', 'the configured artifactIngestRoot does not exist')
    }
    const requested = resolve(root, inputPath)
    let real: string
    try {
      real = await realpath(requested)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TracebookError('INVALID_INPUT', 'path ingestion source does not exist')
      }
      throw error
    }
    if (!isInside(root, real)) {
      throw new TracebookError('INVALID_INPUT', 'path ingestion source escapes the artifact ingest root')
    }
    return readFile(real)
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

  /**
   * P1-12: unlink an artifact's stored bytes so deleting or overwriting an
   * artifact does not leave orphaned files accumulating under the root. Only
   * ever touches files inside our own root, and a missing file is ignored.
   */
  async remove(artifact: Artifact): Promise<void> {
    if (!artifact.path) return
    if (!isInside(this.root, artifact.path)) return
    try {
      await unlink(artifact.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}
