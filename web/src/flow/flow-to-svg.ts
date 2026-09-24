import type { Point } from './elk-layout'

/**
 * Build a standalone SVG string from a laid-out flow graph. Vue Flow renders
 * nodes as HTML, so it cannot be serialized to SVG directly — we redraw the
 * ELK geometry here for export. Colours are baked to concrete hex (light
 * palette) so the file renders without the app stylesheet.
 */
const KIND_HEX: Record<string, string> = {
  frontend: '#0e7490', backend: '#047857', database: '#6d28d9', cloud: '#b45309',
  security: '#be123c', messagebus: '#c2410c', external: '#64748b',
  start: '#0e7490', active: '#0e7490', waiting: '#c2410c', decision: '#b45309',
  success: '#047857', failure: '#be123c', neutral: '#64748b',
}
const ALIASES: Record<string, string> = {
  page: 'frontend', ui: 'frontend', client: 'frontend', view: 'frontend', screen: 'frontend',
  api: 'backend', service: 'backend', server: 'backend', handler: 'backend', worker: 'backend', http: 'backend',
  db: 'database', store: 'database', storage: 'database', cache: 'database', bucket: 'database', model: 'database',
  queue: 'messagebus', topic: 'messagebus', bus: 'messagebus', kafka: 'messagebus', stream: 'messagebus', event: 'messagebus',
  cdn: 'cloud', lb: 'cloud', gateway: 'cloud', infra: 'cloud', k8s: 'cloud',
  auth: 'security', policy: 'security', waf: 'security', iam: 'security', oauth: 'security', token: 'security',
}

export function kindColor(kind?: string): string {
  if (!kind) return KIND_HEX.external!
  return KIND_HEX[kind] ?? KIND_HEX[ALIASES[kind] ?? ''] ?? KIND_HEX.external!
}

export interface SvgNode { x: number; y: number; w: number; h: number; label: string; sublabel?: string; kind?: string; shape: 'box' | 'diamond' | 'pill' }
export interface SvgEdge { points: Point[]; color: string; width: number; dash?: string; label?: string }
export interface SvgGroup { x: number; y: number; w: number; h: number; label: string }

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function arrowhead(points: Point[], color: string): string {
  if (points.length < 2) return ''
  const end = points[points.length - 1]!
  const prev = points[points.length - 2]!
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x)
  const size = 7
  const a1 = angle + Math.PI - 0.5
  const a2 = angle + Math.PI + 0.5
  const p1 = `${end.x + size * Math.cos(a1)},${end.y + size * Math.sin(a1)}`
  const p2 = `${end.x + size * Math.cos(a2)},${end.y + size * Math.sin(a2)}`
  return `<polygon points="${end.x},${end.y} ${p1} ${p2}" fill="${color}"/>`
}

export function buildFlowSvg(options: { width: number; height: number; nodes: SvgNode[]; edges: SvgEdge[]; groups: SvgGroup[] }): string {
  const { width, height } = options
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ]
  for (const group of options.groups) {
    parts.push(`<rect x="${group.x}" y="${group.y}" width="${group.w}" height="${group.h}" rx="6" fill="none" stroke="#cbd5e1" stroke-dasharray="4 4"/>`)
    parts.push(`<text x="${group.x + 8}" y="${group.y + 14}" font-size="10" fill="#64748b" font-family="ui-monospace, monospace">${escapeText(group.label)}</text>`)
  }
  for (const edge of options.edges) {
    const d = edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
    parts.push(`<path d="${d}" fill="none" stroke="${edge.color}" stroke-width="${edge.width}"${edge.dash ? ` stroke-dasharray="${edge.dash}"` : ''}/>`)
    parts.push(arrowhead(edge.points, edge.color))
  }
  for (const node of options.nodes) {
    const color = kindColor(node.kind)
    const rx = node.shape === 'pill' ? node.h / 2 : 8
    parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="${rx}" fill="#ffffff" stroke="${color}" stroke-width="1.5"/>`)
    const cx = node.x + node.w / 2
    const labelY = node.sublabel ? node.y + node.h / 2 - 2 : node.y + node.h / 2 + 4
    parts.push(`<text x="${cx}" y="${labelY}" font-size="12" font-weight="600" fill="${color}" text-anchor="middle">${escapeText(node.label)}</text>`)
    if (node.sublabel) parts.push(`<text x="${cx}" y="${node.y + node.h / 2 + 13}" font-size="9" fill="#64748b" text-anchor="middle" font-family="ui-monospace, monospace">${escapeText(node.sublabel)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('\n')
}
