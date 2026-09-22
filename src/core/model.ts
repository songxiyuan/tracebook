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

export const blockSchema = z.discriminatedUnion('type', [
  markdownBlockSchema,
  factsBlockSchema,
  flowBlockSchema,
  tableBlockSchema,
  timelineBlockSchema,
  evidenceBlockSchema,
  galleryBlockSchema,
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
export type Artifact = z.infer<typeof artifactSchema>
export type CaseDocument = z.infer<typeof caseDocumentSchema>

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
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}
