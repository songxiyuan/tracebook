import type { Block, CaseDocument } from '../../src/core/model'
import { diagramEdgeEndpoints, diagramNodeLabels } from '../../src/core/archify'

/**
 * Client-side export of a case. The Viewer only reads and organizes, so export
 * is a pure projection of the already-loaded `CaseDocument` — no new endpoint,
 * no server round-trip. JSON is the faithful copy; Markdown is a readable
 * digest for pasting into docs/tickets.
 */

/** Trigger a browser download for in-memory text. */
export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next tick so the click has been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** A filesystem-safe slug for the download name. */
export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'case'
}

export function caseToJson(doc: CaseDocument): string {
  return JSON.stringify(doc, null, 2)
}

// __EXPORT_MARKDOWN__

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|')
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Render one block to a Markdown fragment. Unknown shapes fall back to fenced JSON. */
function blockToMarkdown(block: Block): string {
  const heading = `## ${block.title || block.type}`
  const lead = block.description ? `\n${block.description}\n` : ''
  const body = renderBlockBody(block)
  return `${heading}${lead}\n${body}`.trimEnd()
}

function renderBlockBody(block: Block): string {
  switch (block.type) {
    case 'markdown':
      return block.content
    case 'facts':
      return block.items.map((item) => `- **${item.label}**: ${stringifyValue(item.value)}`).join('\n')
    case 'table': {
      const header = `| ${block.columns.map((c) => mdEscape(c.label)).join(' | ')} |`
      const divider = `| ${block.columns.map(() => '---').join(' | ')} |`
      const rows = block.rows.map((row) => `| ${block.columns.map((c) => mdEscape(stringifyValue(row[c.key]))).join(' | ')} |`)
      return [header, divider, ...rows].join('\n')
    }
    case 'timeline':
      return block.items.map((item) => `- ${item.timestamp ? `\`${item.timestamp}\` ` : ''}**${item.title}**${item.description ? ` — ${item.description}` : ''}`).join('\n')
    case 'evidence':
      return block.items.map((item) => `- [${item.kind}] **${item.title}**${item.summary ? ` — ${item.summary}` : ''}`).join('\n')
    case 'gallery':
      return block.items.map((item) => `- ${item.caption || item.artifactRef} (\`${item.artifactRef}\`)`).join('\n')
    case 'api':
      return block.endpoints.map((e) => `- \`${e.method} ${e.path}\`${e.summary ? ` — ${e.summary}` : ''}`).join('\n')
    case 'sequence':
      return block.messages.map((m) => `- ${m.from} ${m.kind === 'stream' ? '⇢' : '→'} ${m.to}: ${m.label}${m.status !== undefined ? ` (${m.status})` : ''}`).join('\n')
    case 'flow':
      return flowToMarkdown(block)
  }
}

function flowToMarkdown(block: Extract<Block, { type: 'flow' }>): string {
  if (block.variant !== 'basic' && block.diagram) {
    const labels = diagramNodeLabels(block.diagram)
    return diagramEdgeEndpoints(block.diagram)
      .map((edge) => `- ${labels.get(edge.from) ?? edge.from} → ${labels.get(edge.to) ?? edge.to}${edge.label ? ` (${edge.label})` : ''}`)
      .join('\n') || '_（无连线）_'
  }
  const labels = new Map((block.nodes ?? []).map((node) => [node.id, node.label]))
  return (block.edges ?? [])
    .map((edge) => `- ${labels.get(edge.source) ?? edge.source} → ${labels.get(edge.target) ?? edge.target}${edge.label ? ` (${edge.label})` : ''}`)
    .join('\n') || (block.nodes ?? []).map((node) => `- ${node.label}`).join('\n')
}

export function caseToMarkdown(doc: CaseDocument): string {
  const head = [
    `# ${doc.title}`,
    '',
    `- **Type**: ${doc.type || 'exploration'}`,
    `- **Status**: ${doc.status}`,
    ...(doc.environment ? [`- **Environment**: ${doc.environment}`] : []),
    `- **Revision**: ${doc.revision}`,
    `- **Updated**: ${doc.updatedAt}`,
    ...(doc.summary ? ['', doc.summary] : []),
  ].join('\n')
  const blocks = doc.blocks.map(blockToMarkdown).join('\n\n')
  const artifacts = doc.artifacts.length
    ? `\n\n## Artifacts\n\n${doc.artifacts.map((a) => `- \`${a.id}\` (${a.kind})${a.name ? ` — ${a.name}` : ''}`).join('\n')}`
    : ''
  return `${head}\n\n${blocks}${artifacts}\n`
}

