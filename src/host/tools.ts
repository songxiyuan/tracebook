import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { buildBlockSchemaReference } from '../core/model.js'
import type { OpenCaseInput, TracebookService, UpdateCaseInput } from '../core/service.js'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{
    type: 'text' as const,
    text: JSON.stringify(value, null, 2),
  }],
}

// P1-9: expose the block protocol on the tool itself so a model constructs a
// valid block without guessing field names or the `type` discriminant. The
// reference is derived from the schema (see buildBlockSchemaReference).
const blockSchemaReference = buildBlockSchemaReference()
const updateDescription = [
  'Incrementally update an investigation case. Blocks are validated and upserted by stable block ID; omitted blocks stay unchanged.',
  'Remove content in the same call with deleteBlockIds / deleteArtifactIds (deleting a missing id is a no-op). Archive a case with status: "archived".',
  '',
  'Block field reference (one line per type; "?" marks optional fields; every block also needs its discriminant "type"):',
  blockSchemaReference,
].join('\n')

export function registerTools(ctx: Context, service: TracebookService) {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'tracebook_open',
      description: 'Create or reopen a Tracebook investigation case and optionally associate it with the current DSH session.',
      parameters: {
        caseId: { type: 'string', description: 'Existing case ID. Omit to create a case.' },
        title: { type: 'string', description: 'Case title. Required for a new case.' },
        type: { type: 'string', description: 'Case type such as exploration, incident, inspection, or architecture.' },
        environment: { type: 'string', description: 'Environment metadata such as production or staging.' },
        sourceSessionId: { type: 'string', description: 'DSH session to associate and make active.' },
      },
      output: jsonOutput,
      async execute(args) {
        return toJson(await service.open(args as OpenCaseInput))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'tracebook_update',
      description: updateDescription,
      parameters: {
        caseId: { type: 'string', description: 'Case ID. May be omitted when sourceSessionId has an active case.' },
        sourceSessionId: { type: 'string', description: 'Associated DSH session.' },
        expectedRevision: { type: 'integer', description: 'Optional optimistic concurrency guard.' },
        title: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string', enum: ['active', 'completed', 'archived'] },
        summary: { type: 'string' },
        environment: { type: 'string' },
        upsertBlocks: {
          type: 'array',
          items: { type: 'json' },
          description: 'Complete markdown, facts, flow, table, timeline, evidence, gallery, api, or sequence blocks to upsert by id. A flow block\'s variant selects a basic node/edge graph or an embedded archify workflow/architecture/dataflow/lifecycle diagram. See the tool description for each type\'s field reference.',
        },
        artifacts: {
          type: 'array',
          items: { type: 'json' },
          description: 'Artifact metadata with an optional contentText, contentBase64, or path payload (mutually exclusive; path is ingested only from a configured allow-list root).',
        },
        deleteBlockIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Block ids to remove from the case in this call. Deleting a missing id is a no-op.',
        },
        deleteArtifactIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Artifact ids to remove from the case in this call; their stored files are unlinked. Deleting a missing id is a no-op.',
        },
      },
      output: jsonOutput,
      async execute(args) {
        return toJson(await service.update(args as unknown as UpdateCaseInput))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'tracebook_context',
      description: 'Read a compact, AI-friendly context projection of an existing Tracebook case before continuing an investigation. Pass blockId to fetch one block\'s complete JSON instead of the compact listing.',
      parameters: {
        caseId: { type: 'string', description: 'Case ID. May be omitted when sourceSessionId has an active case.' },
        sourceSessionId: { type: 'string', description: 'DSH session whose active case should be used.' },
        query: { type: 'string', description: 'Optional literal relevance filter over block content.' },
        maxBlocks: { type: 'integer', description: 'Maximum blocks to return, from 1 to 20.' },
        blockId: { type: 'string', description: 'Return this one block\'s full JSON instead of the compacted listing.' },
      },
      output: jsonOutput,
      async execute(args) {
        return toJson(await service.context(args))
      },
    })),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
