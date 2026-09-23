import { TracebookError } from './errors.js'
import type { Artifact, ArtifactInput } from './model.js'

export interface ArtifactStore {
  save(caseId: string, input: ArtifactInput): Promise<Artifact>
  resolve(artifact: Artifact): Promise<string | undefined>
  /**
   * P1-12: drop an artifact's stored bytes. Optional because not every store
   * owns files (a metadata-only store has nothing to unlink). Callers treat it
   * as best-effort — a failed removal must never fail the surrounding write.
   */
  remove?(artifact: Artifact): Promise<void>
}

export class MetadataOnlyArtifactStore implements ArtifactStore {
  async save(caseId: string, input: ArtifactInput): Promise<Artifact> {
    // P1-10: this store keeps no bytes, so a `path` input has nowhere to be
    // ingested. Reject it rather than silently recording a host path we can
    // neither read from nor serve — the safe choice for a metadata-only store.
    if (input.path !== undefined) {
      throw new TracebookError('INVALID_INPUT', 'path ingestion is not supported by the metadata-only artifact store')
    }
    const content = input.contentBase64
      ? Buffer.from(input.contentBase64, 'base64')
      : input.contentText
        ? Buffer.from(input.contentText)
        : undefined
    return {
      id: input.id ?? crypto.randomUUID(),
      caseId,
      kind: input.kind,
      mimeType: input.mimeType,
      name: input.name,
      summary: input.summary,
      metadata: input.metadata,
      size: content?.byteLength,
      createdAt: new Date().toISOString(),
    }
  }

  async resolve(): Promise<undefined> {
    return undefined
  }

  /** No bytes are stored, so there is nothing to unlink. */
  async remove(): Promise<void> {}
}
