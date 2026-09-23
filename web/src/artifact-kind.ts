import type { Artifact } from '../../src/core/model'

/**
 * Whether an artifact gets an inline `<img>` preview.
 *
 * The declared `mimeType` is the contract; `kind` is only a fallback for the
 * Agent's own vocabulary (`screenshot` / `image` / `png`), so both the Artifact
 * panel and the Flow Node Inspector classify images the same way.
 */
export function isImageArtifact(artifact: Artifact | undefined): boolean {
  if (!artifact) return false
  return artifact.mimeType?.startsWith('image/') === true
    || ['screenshot', 'image', 'png'].includes(artifact.kind)
}
