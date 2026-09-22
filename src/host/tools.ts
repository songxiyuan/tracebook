import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { TracebookService } from '../core/service.js'

const jsonOutput = {
  schema: { type: 'json' as const },
  render: (_args: unknown, value: unknown) => [{
    type: 'text' as const,
    text: JSON.stringify(value, null, 2),
  }],
}

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
        return service.open(args)
      },
    })),
    ctx.tools.register(defineTool({
      name: 'tracebook_update',
      description: 'Incrementally update an investigation case. Blocks are validated and upserted by stable block ID; omitted blocks remain unchanged.',
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
          description: 'Complete markdown, facts, flow, table, timeline, evidence, or gallery blocks to upsert by id.',
        },
        artifacts: {
          type: 'array',
          items: { type: 'json' },
          description: 'Artifact metadata with optional contentText or contentBase64 payload.',
        },
      },
      output: jsonOutput,
      async execute(args) {
        return service.update(args)
      },
    })),
    ctx.tools.register(defineTool({
      name: 'tracebook_context',
      description: 'Read a compact, AI-friendly context projection of an existing Tracebook case before continuing an investigation.',
      parameters: {
        caseId: { type: 'string', description: 'Case ID. May be omitted when sourceSessionId has an active case.' },
        sourceSessionId: { type: 'string', description: 'DSH session whose active case should be used.' },
        query: { type: 'string', description: 'Optional literal relevance filter over block content.' },
        maxBlocks: { type: 'integer', description: 'Maximum blocks to return, from 1 to 20.' },
      },
      output: jsonOutput,
      async execute(args) {
        return service.context(args)
      },
    })),
  ]
  return () => disposers.reverse().forEach((dispose) => dispose())
}
