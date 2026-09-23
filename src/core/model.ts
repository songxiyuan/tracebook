import { z } from 'zod'
import { TracebookError } from './errors.js'

const nonEmpty = z.string().trim().min(1)
const metadataSchema = z.record(z.string(), z.unknown())

export const blockBaseSchema = z.object({
  id: nonEmpty,
  title: z.string().optional(),
  description: z.string().optional(),
  artifactRefs: z.array(nonEmpty).optional(),
  sourceSessionId: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
})

export const markdownBlockSchema = blockBaseSchema.extend({
  type: z.literal('markdown'),
  content: z.string(),
})

export const factsBlockSchema = blockBaseSchema.extend({
  type: z.literal('facts'),
  items: z.array(z.object({
    label: nonEmpty,
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })),
})

export const flowNodeSchema = z.object({
  id: nonEmpty,
  label: nonEmpty,
  kind: z.string().optional(),
  details: z.string().optional(),
  artifactRefs: z.array(nonEmpty).optional(),
  relatedBlockIds: z.array(nonEmpty).optional(),
  metadata: metadataSchema.optional(),
})

export const flowEdgeSchema = z.object({
  id: nonEmpty,
  source: nonEmpty,
  target: nonEmpty,
  label: z.string().optional(),
  details: z.string().optional(),
  artifactRefs: z.array(nonEmpty).optional(),
  relatedBlockIds: z.array(nonEmpty).optional(),
  metadata: metadataSchema.optional(),
})

export const flowBlockSchema = blockBaseSchema.extend({
  type: z.literal('flow'),
  direction: z.enum(['TB', 'BT', 'LR', 'RL']).default('TB'),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
}).superRefine((block, ctx) => {
  // P1-1: node and edge ids must be unique within the block, otherwise a later
  // upsert or a Viewer lookup silently resolves to whichever duplicate wins.
  const seenNodeIds = new Set<string>()
  for (const node of block.nodes) {
    if (seenNodeIds.has(node.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate flow node id ${node.id}` })
    }
    seenNodeIds.add(node.id)
  }
  const seenEdgeIds = new Set<string>()
  for (const edge of block.edges) {
    if (seenEdgeIds.has(edge.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate flow edge id ${edge.id}` })
    }
    seenEdgeIds.add(edge.id)
  }
  const nodeIds = new Set(block.nodes.map((node) => node.id))
  for (const edge of block.edges) {
    if (!nodeIds.has(edge.source)) {
      ctx.addIssue({ code: 'custom', message: `Edge ${edge.id} references missing source ${edge.source}` })
    }
    if (!nodeIds.has(edge.target)) {
      ctx.addIssue({ code: 'custom', message: `Edge ${edge.id} references missing target ${edge.target}` })
    }
  }
})

export const tableBlockSchema = blockBaseSchema.extend({
  type: z.literal('table'),
  columns: z.array(z.object({ key: nonEmpty, label: nonEmpty })),
  rows: z.array(z.record(z.string(), z.unknown())),
}).superRefine((block, ctx) => {
  // P1-1: a table addresses each cell by column key, so two columns sharing a
  // key would make the row lookup ambiguous.
  const seenKeys = new Set<string>()
  for (const column of block.columns) {
    if (seenKeys.has(column.key)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate table column key ${column.key}` })
    }
    seenKeys.add(column.key)
  }
})

export const timelineBlockSchema = blockBaseSchema.extend({
  type: z.literal('timeline'),
  items: z.array(z.object({
    title: nonEmpty,
    description: z.string().optional(),
    timestamp: z.string().optional(),
    artifactRefs: z.array(nonEmpty).optional(),
  })),
})

export const evidenceBlockSchema = blockBaseSchema.extend({
  type: z.literal('evidence'),
  items: z.array(z.object({
    id: nonEmpty,
    kind: nonEmpty,
    title: nonEmpty,
    summary: z.string().optional(),
    artifactRef: z.string().optional(),
    metadata: metadataSchema.optional(),
  })),
})

export const galleryBlockSchema = blockBaseSchema.extend({
  type: z.literal('gallery'),
  items: z.array(z.object({
    artifactRef: nonEmpty,
    caption: z.string().optional(),
  })),
})

/** Standard HTTP methods an investigated endpoint may declare. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** Where an observed duration came from. `estimated` is Agent inference, never a measurement. */
export const TIMING_SOURCES = ['trace', 'har', 'log', 'metrics', 'estimated'] as const

/**
 * Where a request or response example came from.
 *
 * An observed sample and an invented illustration must not look the same in
 * the Viewer, so an example is never valid without saying which it is.
 */
export const EXAMPLE_SOURCES = ['observed', 'spec', 'inferred'] as const

const exampleSourceSchema = z.enum(EXAMPLE_SOURCES)

/** An example carries its provenance, exactly like a timing number carries its source. */
function exampleRequiresSource<T extends { example?: unknown; source?: unknown }>(value: T): boolean {
  return value.example === undefined || value.source !== undefined
}

/**
 * Observed timing for one endpoint.
 *
 * The shape is evidence-first on purpose: `source` is required, so the Viewer
 * can never present a bare number as a measured latency, and `estimated`
 * inference stays visibly separate from Trace / HAR / Log observations. At
 * least one sample, aggregate, or phase breakdown must be present, so an empty
 * `timing` object cannot claim to have measured anything.
 *
 * Rate and errors ride along so a percentile is never read alone: `sampleSize`
 * is the request count behind the percentiles, `errorCount` is how many of
 * them failed. A declared target lives on the endpoint instead, because a
 * budget is contract, not observation.
 */
export const apiTimingSchema = z.object({
  source: z.enum(TIMING_SOURCES),
  unit: z.literal('ms').default('ms'),
  /** Requests observed in the window: the percentile basis and the error-rate denominator. */
  sampleSize: z.number().int().positive().optional(),
  /** Of `sampleSize`, how many failed; the Viewer derives the error rate from the two. */
  errorCount: z.number().int().nonnegative().optional(),
  /** Raw observations, kept so a reader can judge the distribution. */
  samples: z.array(z.number().nonnegative()).optional(),
  p50: z.number().nonnegative().optional(),
  p95: z.number().nonnegative().optional(),
  p99: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  /**
   * Round-trip phases, in the reader-facing vocabulary.
   *
   * `ttfb` and `download` are the honest names for the HAR `wait` and
   * `receive` phases; HAR's `ssl` is a sub-interval of `connect` (kept there
   * for 1.1 compatibility), so it never becomes a sibling segment, and
   * `blocked` / `send` are deliberately not modelled yet.
   */
  breakdown: z.object({
    dns: z.number().nonnegative().optional(),
    connect: z.number().nonnegative().optional(),
    ttfb: z.number().nonnegative().optional(),
    download: z.number().nonnegative().optional(),
  }).optional(),
  /** Aggregation window the numbers describe; an unqualified rate is not interpretable. */
  window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).optional(),
  measuredAt: z.string().datetime().optional(),
  /** How the number was obtained; required reading whenever `source` is `estimated`. */
  note: z.string().optional(),
  /** Artifact the number was read from, so it stays traceable to raw evidence. */
  artifactRef: nonEmpty.optional(),
}).refine(
  (timing) => timing.samples !== undefined
    || timing.p50 !== undefined
    || timing.p95 !== undefined
    || timing.p99 !== undefined
    || timing.max !== undefined
    || timing.breakdown !== undefined,
  { message: 'Timing must carry samples, an aggregate, or a breakdown' },
).refine(
  (timing) => timing.errorCount === undefined
    || timing.sampleSize === undefined
    || timing.errorCount <= timing.sampleSize,
  { message: 'errorCount cannot exceed sampleSize' },
)

export const apiEndpointSchema = z.object({
  id: nonEmpty,
  method: z.string().trim().min(1).transform((value) => value.toUpperCase())
    .pipe(z.enum(HTTP_METHODS)),
  path: nonEmpty,
  summary: z.string().optional(),
  service: z.string().optional(),
  /**
   * Declared or target latency (an SLO), not an observation.
   *
   * Kept on the endpoint because it is part of the contract: the Viewer only
   * colours an observed number against a threshold someone actually declared,
   * never against one it invented. No standard OpenAPI field exists, so
   * `expectedRef` records where the number came from.
   */
  expectedMs: z.number().nonnegative().optional(),
  /** Where `expectedMs` is declared, e.g. an `x-expected-response-time-ms` extension or a doc URL. */
  expectedRef: z.string().optional(),
  request: z.object({
    params: z.array(z.object({
      name: nonEmpty,
      in: z.enum(['query', 'path', 'header', 'body']),
      type: z.string().optional(),
      required: z.boolean().optional(),
      example: z.unknown().optional(),
      source: exampleSourceSchema.optional(),
    }).refine(exampleRequiresSource, { message: 'An example must declare its source' })).optional(),
    body: z.object({
      contentType: z.string().optional(),
      example: z.unknown().optional(),
      source: exampleSourceSchema.optional(),
      schemaArtifactRef: nonEmpty.optional(),
    }).refine(exampleRequiresSource, { message: 'An example must declare its source' }).optional(),
  }).optional(),
  responses: z.array(z.object({
    status: z.number().int().min(100).max(599),
    description: z.string().optional(),
    contentType: z.string().optional(),
    example: z.unknown().optional(),
    source: exampleSourceSchema.optional(),
    artifactRef: nonEmpty.optional(),
  }).refine(exampleRequiresSource, { message: 'An example must declare its source' })).optional(),
  timing: apiTimingSchema.optional(),
  artifactRefs: z.array(nonEmpty).optional(),
  relatedBlockIds: z.array(nonEmpty).optional(),
})

/**
 * An investigated API surface: many endpoints, each optionally carrying its
 * request, responses, and observed timing.
 *
 * Kept separate from `table` even though a simple interface list could be
 * expressed as rows: endpoint detail has its own semantics (request shape,
 * status codes, a timing breakdown with a provenance), and `table.rows` is
 * untyped by design. Generic tabular data stays in `table`.
 */
export const apiBlockSchema = blockBaseSchema.extend({
  type: z.literal('api'),
  endpoints: z.array(apiEndpointSchema),
}).superRefine((block, ctx) => {
  // P1-1: endpoint ids are the stable handles a block's timing and refs hang
  // off, so a duplicate would make those references ambiguous.
  const seenIds = new Set<string>()
  for (const endpoint of block.endpoints) {
    if (seenIds.has(endpoint.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate api endpoint id ${endpoint.id}` })
    }
    seenIds.add(endpoint.id)
  }
})

export const sequenceParticipantSchema = z.object({
  id: nonEmpty,
  label: nonEmpty,
  /** Free-form role hint, e.g. `page` / `gateway` / `service` / `SSE`, used only for display. */
  kind: z.string().optional(),
})

export const sequenceMessageSchema = z.object({
  id: nonEmpty,
  /** Participant id the message leaves from. */
  from: nonEmpty,
  /** Participant id the message arrives at. */
  to: nonEmpty,
  /** The event name, e.g. `create` or `job.completed`. */
  label: nonEmpty,
  /**
   * How the message travels: a `sync` call blocks for its reply, an `async`
   * fire-and-forget does not, and a `stream` is an open server push (SSE / WS).
   */
  kind: z.enum(['sync', 'async', 'stream']).default('sync'),
  status: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().nonnegative().optional(),
  /** Where `durationMs` came from; reuses the endpoint timing provenance so an inferred number stays labelled. */
  timingSource: z.enum(TIMING_SOURCES).optional(),
  artifactRefs: z.array(nonEmpty).optional(),
  note: z.string().optional(),
})

/**
 * A time-ordered message exchange between participants.
 *
 * Kept separate from `flow` on purpose: a `flow` is a topology graph (who talks
 * to whom), while a request → response → async-push interaction is a sequence
 * in time, and forcing it into a graph loses the ordering that makes it
 * readable. Participants are the lifelines; messages are the ordered arrows.
 */
export const sequenceBlockSchema = blockBaseSchema.extend({
  type: z.literal('sequence'),
  participants: z.array(sequenceParticipantSchema),
  messages: z.array(sequenceMessageSchema),
}).superRefine((block, ctx) => {
  // P1-1: participant and message ids are the stable handles the Viewer looks
  // up, so a duplicate would silently resolve to whichever one wins.
  const seenParticipantIds = new Set<string>()
  for (const participant of block.participants) {
    if (seenParticipantIds.has(participant.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate sequence participant id ${participant.id}` })
    }
    seenParticipantIds.add(participant.id)
  }
  const seenMessageIds = new Set<string>()
  for (const message of block.messages) {
    if (seenMessageIds.has(message.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate sequence message id ${message.id}` })
    }
    seenMessageIds.add(message.id)
  }
  const participantIds = new Set(block.participants.map((participant) => participant.id))
  for (const message of block.messages) {
    if (!participantIds.has(message.from)) {
      ctx.addIssue({ code: 'custom', message: `Message ${message.id} references missing from ${message.from}` })
    }
    if (!participantIds.has(message.to)) {
      ctx.addIssue({ code: 'custom', message: `Message ${message.id} references missing to ${message.to}` })
    }
  }
})

export const blockSchema = z.discriminatedUnion('type', [
  markdownBlockSchema,
  factsBlockSchema,
  flowBlockSchema,
  tableBlockSchema,
  timelineBlockSchema,
  evidenceBlockSchema,
  galleryBlockSchema,
  apiBlockSchema,
  sequenceBlockSchema,
])

/**
 * A compact, per-type field reference for the block protocol, so a model can
 * construct a valid block from the tool description without guessing field
 * names or the `type` discriminant.
 *
 * The reference is derived from the schema itself via zod v4's
 * `z.toJSONSchema` (input side, before transforms), so it stays in sync when a
 * block gains a field. `z.toJSONSchema` is unavailable or throws on some schema
 * shapes; when that happens we fall back to a hand-written summary rather than
 * shipping a broken description.
 */
export function buildBlockSchemaReference(): string {
  try {
    const toJsonSchema = (z as unknown as {
      toJSONSchema?: (schema: unknown, options?: unknown) => Record<string, unknown>
    }).toJSONSchema
    if (typeof toJsonSchema !== 'function') return HAND_WRITTEN_BLOCK_REFERENCE
    const json = toJsonSchema(blockSchema, { unrepresentable: 'any', io: 'input' })
    const variants = (json.oneOf ?? json.anyOf) as Array<Record<string, unknown>> | undefined
    if (!variants?.length) return HAND_WRITTEN_BLOCK_REFERENCE
    const lines = variants.map((variant) => {
      const properties = (variant.properties ?? {}) as Record<string, { const?: unknown }>
      const required = new Set((variant.required as string[] | undefined) ?? [])
      const typeName = String(properties.type?.const ?? '?')
      const fields = Object.keys(properties)
        .filter((key) => key !== 'type')
        .map((key) => (required.has(key) ? key : `${key}?`))
      return `${typeName}: ${fields.join(', ')}`
    })
    return lines.join('\n')
  } catch {
    return HAND_WRITTEN_BLOCK_REFERENCE
  }
}

/** Fallback used only if the schema-to-JSON-Schema conversion is unavailable. */
const HAND_WRITTEN_BLOCK_REFERENCE = [
  'markdown: id, title?, description?, artifactRefs?, content',
  'facts: id, title?, description?, artifactRefs?, items[{label,value}]',
  'flow: id, title?, description?, artifactRefs?, direction?, nodes[{id,label,kind?,relatedBlockIds?}], edges[{id,source,target,label?}]',
  'table: id, title?, description?, artifactRefs?, columns[{key,label}], rows',
  'timeline: id, title?, description?, artifactRefs?, items[{title,description?,timestamp?,artifactRefs?}]',
  'evidence: id, title?, description?, artifactRefs?, items[{id,kind,title,summary?,artifactRef?}]',
  'gallery: id, title?, description?, artifactRefs?, items[{artifactRef,caption?}]',
  'api: id, title?, description?, artifactRefs?, endpoints[{id,method,path,summary?,responses?,timing?}]',
  'sequence: id, title?, description?, artifactRefs?, participants[{id,label,kind?}], messages[{id,from,to,label,kind,status?,durationMs?,timingSource?,artifactRefs?,note?}]',
].join('\n')

export const artifactSchema = z.object({
  id: nonEmpty,
  caseId: nonEmpty,
  kind: nonEmpty,
  mimeType: z.string().optional(),
  name: z.string().optional(),
  path: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  metadata: metadataSchema.optional(),
  createdAt: z.string().datetime(),
})

export const caseDocumentSchema = z.object({
  id: nonEmpty,
  title: nonEmpty,
  type: z.string().optional(),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
  summary: z.string().optional(),
  environment: z.string().optional(),
  blocks: z.array(blockSchema),
  artifacts: z.array(artifactSchema).default([]),
  sourceSessions: z.array(z.string()).default([]),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Block = z.infer<typeof blockSchema>
export type FlowBlock = z.infer<typeof flowBlockSchema>
export type ApiBlock = z.infer<typeof apiBlockSchema>
export type ApiEndpoint = z.infer<typeof apiEndpointSchema>
export type ApiTiming = z.infer<typeof apiTimingSchema>
export type SequenceBlock = z.infer<typeof sequenceBlockSchema>
export type Artifact = z.infer<typeof artifactSchema>
export type CaseDocument = z.infer<typeof caseDocumentSchema>

/**
 * One stored point in a case's history: the state a revision reached.
 *
 * History is derived bookkeeping, not a second protocol: the snapshot is built
 * from the same `CaseDocument` the case itself stores, and only the fields a
 * reader diffs (title, summary, status, blocks) are retained.
 */
export const caseRevisionSnapshotSchema = z.object({
  caseId: nonEmpty,
  revision: z.number().int().positive(),
  title: nonEmpty,
  status: z.enum(['active', 'completed', 'archived']).default('active'),
  summary: z.string().optional(),
  blocks: z.array(blockSchema),
  updatedAt: z.string().datetime(),
})

export type CaseRevisionSnapshot = z.infer<typeof caseRevisionSnapshotSchema>

/** Project the case's current state into the revision snapshot that history stores. */
export function revisionSnapshotOf(document: CaseDocument): CaseRevisionSnapshot {
  return caseRevisionSnapshotSchema.parse({
    caseId: document.id,
    revision: document.revision,
    title: document.title,
    status: document.status,
    summary: document.summary,
    blocks: document.blocks,
    updatedAt: document.updatedAt,
  })
}

/** A revision without its blocks, for history list reads. */
export interface CaseRevisionSummary {
  caseId: string
  revision: number
  title: string
  status: CaseDocument['status']
  summary?: string
  blockCount: number
  updatedAt: string
}

export function summarizeRevision(snapshot: CaseRevisionSnapshot): CaseRevisionSummary {
  return {
    caseId: snapshot.caseId,
    revision: snapshot.revision,
    title: snapshot.title,
    status: snapshot.status,
    summary: snapshot.summary,
    blockCount: snapshot.blocks.length,
    updatedAt: snapshot.updatedAt,
  }
}

/**
 * Hard ceiling on a single artifact payload, in bytes.
 *
 * The Agent tools carry artifact bytes inline as base64 or text through the
 * model's own context, so an unbounded payload is an MB-scale base64 blob
 * pushed through the tool call and stored verbatim. The cap protects the model
 * and the store from that; on violation we reject (INVALID_INPUT / HTTP 400)
 * rather than silently truncating, because a truncated artifact is a lie.
 */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024

/** Max blocks a single `tracebook_update` may upsert, so one call cannot balloon the payload. */
export const MAX_UPSERT_BLOCKS = 200

/** Max artifacts a single `tracebook_update` may carry, for the same payload-protection reason. */
export const MAX_ARTIFACTS_PER_UPDATE = 50

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * A pragmatic base64 validity check: `Buffer.from(x, 'base64')` silently drops
 * invalid characters instead of failing, so a malformed payload would decode to
 * garbage without this guard. Whitespace (line-wrapped base64) is tolerated.
 */
export function isValidBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '')
  if (normalized.length % 4 !== 0) return false
  return BASE64_PATTERN.test(normalized)
}

/**
 * Reject an oversized or malformed inline artifact payload before it reaches
 * the store. Throws `TracebookError('INVALID_INPUT')` (HTTP 400) so a caller
 * learns the byte budget instead of getting a truncated file.
 */
export function assertArtifactPayloadWithinLimits(input: ArtifactInput): void {
  if (input.contentBase64 !== undefined) {
    if (!isValidBase64(input.contentBase64)) {
      throw new TracebookError('INVALID_INPUT', 'contentBase64 is not valid base64')
    }
    const bytes = Buffer.from(input.contentBase64, 'base64').byteLength
    if (bytes > MAX_ARTIFACT_BYTES) {
      throw new TracebookError(
        'INVALID_INPUT',
        `Artifact payload of ${bytes} bytes exceeds the ${MAX_ARTIFACT_BYTES}-byte limit`,
      )
    }
  }
  if (input.contentText !== undefined) {
    const bytes = Buffer.byteLength(input.contentText, 'utf8')
    if (bytes > MAX_ARTIFACT_BYTES) {
      throw new TracebookError(
        'INVALID_INPUT',
        `Artifact payload of ${bytes} bytes exceeds the ${MAX_ARTIFACT_BYTES}-byte limit`,
      )
    }
  }
}

export const artifactInputSchema = z.object({
  id: nonEmpty.optional(),
  kind: nonEmpty,
  mimeType: z.string().optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  metadata: metadataSchema.optional(),
  contentBase64: z.string().optional(),
  contentText: z.string().optional(),
  // P1-10: ingest a file from an allow-listed host directory instead of inline
  // bytes. Mutually exclusive with the inline payloads and only honoured when
  // the store is configured with an ingest root (see FileArtifactStore).
  path: z.string().optional(),
}).refine((value) => {
  const sources = [value.contentBase64, value.contentText, value.path].filter((source) => source !== undefined)
  return sources.length <= 1
}, {
  message: 'Provide only one of contentBase64, contentText, or path',
})

export type ArtifactInput = z.infer<typeof artifactInputSchema>

export interface CaseSummary {
  id: string
  title: string
  type?: string
  status: CaseDocument['status']
  summary?: string
  environment?: string
  blockCount: number
  artifactCount: number
  revision: number
  /** DSH sessions linked to this case; the Viewer uses it to resolve the current session's case. */
  sourceSessions: string[]
  createdAt: string
  updatedAt: string
}

export function summarizeCase(document: CaseDocument): CaseSummary {
  return {
    id: document.id,
    title: document.title,
    type: document.type,
    status: document.status,
    summary: document.summary,
    environment: document.environment,
    blockCount: document.blocks.length,
    artifactCount: document.artifacts.length,
    revision: document.revision,
    sourceSessions: document.sourceSessions,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}
