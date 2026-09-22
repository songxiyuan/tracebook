import type { Artifact, ArtifactInput } from './model.js'

export interface ArtifactStore {
  save(caseId: string, input: ArtifactInput): Promise<Artifact>
  resolve(artifact: Artifact): Promise<string | undefined>
}

export class MetadataOnlyArtifactStore implements ArtifactStore {
  async save(caseId: string, input: ArtifactInput): Promise<Artifact> {
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
}
