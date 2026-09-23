import { z } from 'zod'

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
 * Observed timing for one endpoint.
 *
 * The shape is evidence-first on purpose: `source` is required, so the Viewer
 * can never present a bare number as a measured latency, and `estimated`
 * inference stays visibly separate from Trace / HAR / Log observations. At
 * least one sample, aggregate, or phase breakdown must be present, so an empty
 * `timing` object cannot claim to have measured anything.
 */
export const apiTimingSchema = z.object({
  source: z.enum(TIMING_SOURCES),
  unit: z.literal('ms').default('ms'),
  sampleSize: z.number().int().positive().optional(),
  /** Raw observations, kept so a reader can judge the distribution. */
  samples: z.array(z.number().nonnegative()).optional(),
  p50: z.number().nonnegative().optional(),
  p95: z.number().nonnegative().optional(),
  p99: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  /** Round-trip phases, matching the HAR `timings` vocabulary. */
  breakdown: z.object({
    dns: z.number().nonnegative().optional(),
    connect: z.number().nonnegative().optional(),
    ttfb: z.number().nonnegative().optional(),
    download: z.number().nonnegative().optional(),
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
)

export const apiEndpointSchema = z.object({
  id: nonEmpty,
  method: z.string().trim().min(1).transform((value) => value.toUpperCase())
    .pipe(z.enum(HTTP_METHODS)),
  path: nonEmpty,
  summary: z.string().optional(),
  service: z.string().optional(),
  request: z.object({
    params: z.array(z.object({
      name: nonEmpty,
      in: z.enum(['query', 'path', 'header', 'body']),
      type: z.string().optional(),
      required: z.boolean().optional(),
      example: z.unknown().optional(),
    })).optional(),
    body: z.object({
      contentType: z.string().optional(),
      example: z.unknown().optional(),
      schemaArtifactRef: nonEmpty.optional(),
    }).optional(),
  }).optional(),
  responses: z.array(z.object({
    status: z.number().int().min(100).max(599),
    description: z.string().optional(),
    contentType: z.string().optional(),
    example: z.unknown().optional(),
    artifactRef: nonEmpty.optional(),
  })).optional(),
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
])

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

export const artifactInputSchema = z.object({
  id: nonEmpty.optional(),
  kind: nonEmpty,
  mimeType: z.string().optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  metadata: metadataSchema.optional(),
  contentBase64: z.string().optional(),
  contentText: z.string().optional(),
}).refine((value) => !(value.contentBase64 && value.contentText), {
  message: 'Provide only one of contentBase64 or contentText',
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
