export class TracebookError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT' | 'ARTIFACT_NOT_FOUND' | 'REVISION_NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'TracebookError'
  }
}
